import type { Metadata } from "next";
import { PosavasoTool } from "@/components/tools/posavasos/posavasos-tool";

export const metadata: Metadata = {
  title: "Posavasos",
  description:
    "Convierte tus diseños vectorizados en posavasos con relieve listos para imprimir en 3D. Todo en tu navegador.",
};

export default function PosavasosPage() {
  return <PosavasoTool />;
}
