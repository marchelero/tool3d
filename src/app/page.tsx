import Link from "next/link";
import { ArrowRight, Hammer, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TOOLS, type ToolDefinition } from "@/lib/tools/registry";

function ToolCard({ tool }: { tool: ToolDefinition }) {
  const Icon = tool.icon;
  const available = tool.status === "available";

  const body = (
    <Card
      className={
        available
          ? "h-full transition-colors hover:border-primary/60 hover:bg-accent/40"
          : "h-full opacity-70"
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4.5" />
          </span>
          <Badge variant={available ? "default" : "secondary"}>
            {available ? "Disponible" : "Próximamente"}
          </Badge>
        </div>
        <CardTitle className="mt-2 flex items-center gap-1.5 text-base">
          {tool.name}
          {available ? (
            <ArrowRight className="size-4 text-muted-foreground" />
          ) : null}
        </CardTitle>
        <CardDescription>{tool.description}</CardDescription>
      </CardHeader>
    </Card>
  );

  if (!available) {
    return <div aria-disabled>{body}</div>;
  }

  return (
    <Link href={`/tools/${tool.slug}`} className="block focus-visible:outline-none">
      {body}
    </Link>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-16">
      <section className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" />
          Kit de utilidades para impresión 3D
        </span>
        <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Todo lo que necesitas antes de imprimir
        </h1>
        <p className="mt-4 text-pretty text-muted-foreground">
          Prepara imágenes, quita fondos, vectoriza y separa por colores. Un pack
          modular que seguirá creciendo con nuevas herramientas 3D.
        </p>
      </section>

      <section className="mt-12">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Hammer className="size-4" />
          Herramientas
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} />
          ))}
        </div>
      </section>
    </div>
  );
}
