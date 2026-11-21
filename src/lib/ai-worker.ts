import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import ExcelJS from "exceljs";
import { adminClient } from "./supabase/server";
import { analysisSchema, analysisInstructions, draftItems } from "./ai-schema";
import type { Drawing } from "./schemas";
export async function processOneJob() {
  const db = adminClient();
  const { data: job, error } = await db.rpc("claim_analysis_job");
  if (error) throw new Error("Job queue unavailable.");
  if (!job?.id) return { processed: false };
  const update = async (values: Record<string, unknown>) => {
    const { error } = await db
      .from("ai_analysis_jobs")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("lease_token", job.lease_token)
      .eq("status", "running");
    if (error) throw new Error("Could not checkpoint job.");
  };
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 35000,
    maxRetries: 0,
  });
  try {
    const { data: d, error: docError } = await db
      .from("drawings")
      .select("*")
      .eq("id", job.drawing_id)
      .eq("org_id", job.org_id)
      .eq("project_id", job.project_id)
      .single();
    if (docError || !d || d.status !== "ready")
      throw new Error("Document is unavailable.");
    const drawing = d as Drawing;
    let response;
    if (job.response_id) {
      response = await client.responses.retrieve(job.response_id);
    } else {
      const content: ResponseInputContent[] = [
        {
          type: "input_text",
          text: `Analyse document ${drawing.name}. Drawing number ${drawing.number}; revision ${drawing.revision}. It has ${drawing.page_count} pages. Document ID ${drawing.id}.`,
        },
      ];
      if (
        drawing.mime === "application/pdf" ||
        drawing.mime.startsWith("image/")
      ) {
        const { data: signed, error } = await db.storage
          .from("documents")
          .createSignedUrl(drawing.path, 3600);
        if (error) throw new Error("Could not access document.");
        content.push(
          drawing.mime === "application/pdf"
            ? { type: "input_file", file_url: signed.signedUrl }
            : {
                type: "input_image",
                image_url: signed.signedUrl,
                detail: "high",
              },
        );
      } else {
        const { data: blob, error } = await db.storage
          .from("documents")
          .download(drawing.path);
        if (error || !blob) throw new Error("Could not read document.");
        let text = "";
        if (drawing.mime.includes("spreadsheetml")) {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(
            Buffer.from(await blob.arrayBuffer()) as unknown as Parameters<
              typeof workbook.xlsx.load
            >[0],
          );
          for (const s of workbook.worksheets) {
            s.eachRow((row, index) => {
              text += `${s.name} row ${index}: ${row.values?.toString()}\n`;
            });
          }
        } else {
          text = await blob.text();
        }
        if (text.length > 60000)
          throw new Error(
            "Text exceeds 60,000 characters. Split the document before analysis.",
          );
        content.push({ type: "input_text", text });
      }
      response = await client.responses.create({
        model: process.env.OPENAI_MODEL!,
        background: true,
        store: true,
        instructions: analysisInstructions,
        input: [{ role: "user", content }],
        text: { format: zodTextFormat(analysisSchema, "civil_estimate_draft") },
        max_output_tokens: 12000,
      });
      await update({ response_id: response.id });
      job.response_id = response.id;
    }
    if (response.status === "completed") {
      const result = analysisSchema.parse(JSON.parse(response.output_text));
      const items = draftItems(result, drawing);
      const { data: committed, error } = await db.rpc("finish_analysis_job", {
        p_id: job.id,
        p_lease: job.lease_token,
        p_items: items,
        p_result: { summary: result.summary, warnings: result.warnings },
      });
      if (error || !committed) throw new Error("Could not commit analysis.");
      await client.responses.delete(response.id).catch(() => {});
      return { processed: true, status: "completed", items: items.length };
    }
    if (["failed", "cancelled", "incomplete"].includes(response.status ?? "")) {
      await update({
        status: "failed",
        error:
          "AI did not return a complete result. Split the document or check the configured model, then queue it again.",
        lease_until: null,
      });
      await client.responses.delete(response.id).catch(() => {});
      return { processed: true, status: "failed" };
    }
    await update({
      lease_until: null,
      failures: 0,
      available_at: new Date(Date.now() + 15000).toISOString(),
    });
    return { processed: true, status: "running" };
  } catch (error) {
    console.error(
      "Analysis job failure",
      job.id,
      error instanceof Error ? error.message : "Unknown error",
    );
    const retryable =
      error instanceof OpenAI.APIConnectionError ||
      (error instanceof OpenAI.APIError &&
        (error.status === 429 || (error.status ?? 0) >= 500));
    const retry = retryable && job.attempts < 3 && (job.failures ?? 0) < 2;
    await update({
      status: retry ? "queued" : "failed",
      failures: (job.failures ?? 0) + 1,
      response_id: job.response_id ?? null,
      error: retry
        ? "Provider temporarily unavailable; retry scheduled."
        : "Analysis failed validation or processing. Check the model and document, then queue again.",
      lease_until: null,
      available_at: new Date(
        Date.now() + Math.pow(2, job.attempts) * 60000,
      ).toISOString(),
    });
    return { processed: true, status: retry ? "queued" : "failed" };
  }
}
