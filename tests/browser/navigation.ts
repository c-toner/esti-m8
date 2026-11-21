// Test-only Next router adapter; never included in the production Next.js app.
export function useRouter() {
  return {
    push: (path: string) => {
      window.history.pushState({}, "", path);
      window.dispatchEvent(new Event("popstate"));
    },
    refresh: () => {},
  };
}
