export default function Loading() {
  return (
    <main
      className="fixed inset-0 z-[9997] bg-[radial-gradient(circle_at_50%_45%,rgba(64,0,4,0.18)_0%,rgba(7,7,7,0.98)_72%)] text-white"
      data-route-loading
    >
      <div
        aria-atomic="true"
        aria-live="polite"
        className="fixed inset-0"
        data-route-loading-spinner
        role="status"
      >
        <span
          aria-hidden="true"
          className="fixed left-[50vw] top-[50vh] block h-14 w-14 -translate-x-1/2 -translate-y-1/2"
          data-navigation-spinner-anchor
        >
          <span className="navigation-feedback-spinner absolute inset-0 block rounded-full border-[3px] border-white/15 border-r-[var(--accent)] border-t-[var(--accent)] shadow-[0_0_24px_rgba(229,9,20,0.24)]" />
        </span>
        <span className="sr-only">Carregando página...</span>
      </div>
    </main>
  );
}
