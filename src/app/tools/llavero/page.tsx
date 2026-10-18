import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Llavero con imagen",
  description:
    "Convierte tus diseños vectorizados en llaveros listos para imprimir en 3D. Todo en tu navegador.",
};

export default function LlaveroPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="mb-6">
        <Badge>Llaveros</Badge>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Llavero con imagen
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Convierte el diseño vectorizado en una pieza compacta con anilla de
          sujeción.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" />
            Módulo en preparación
          </CardTitle>
          <CardDescription>
            Acá vas a poder ajustar el tamaño, el agujero de la anilla y el
            relieve del llavero antes de exportar el modelo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" variant="outline">
            <Link href="/tools/image">
              <ArrowLeft className="size-4" />
              Volver a la herramienta de imagen
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
