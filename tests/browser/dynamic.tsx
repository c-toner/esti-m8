import { lazy, Suspense, type ComponentType } from "react";
// Test-only equivalent for client-side dynamic components.
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  options?: { loading?: ComponentType; ssr?: boolean },
) {
  const Component = lazy(loader);
  const Loading = options?.loading;
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Component {...props} />
      </Suspense>
    );
  };
}
