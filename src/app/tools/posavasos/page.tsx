import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Coffee } from "lucide-react";
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
  title: "Posavasos",
  description:
    "Convierte tus diseños vectorizados en posavasos listos para imprimir en 3D. Todo en tu navegador.",
};

export default function PosavasosPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="mb-6">
        <Badge>Posavasos</Badge>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Posavasos
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Convierte el diseño vectorizado en una base circular con el relieve
          listo para imprimir.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coffee className="size-4" />
            Módulo en preparación
          </CardTitle>
          <CardDescription>
            Acá vas a poder ajustar el diámetro, el grosor y el relieve del
            posavasos antes de exportar el modelo.
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
