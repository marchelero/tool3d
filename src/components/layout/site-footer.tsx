import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
        <p>Tool3D — herramientas para impresión 3D.</p>
        <p className="flex items-center gap-1">
          <span>Hecho con Next.js</span>
          <span aria-hidden>·</span>
          <Link
            href="https://github.com/marchelero/tool3d"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
          >
            GitHub
          </Link>
        </p>
      </div>
    </footer>
  );
}
