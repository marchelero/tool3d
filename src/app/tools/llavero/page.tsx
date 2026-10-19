import type { Metadata } from "next";
import { KeychainTool } from "@/components/tools/llavero/keychain-tool";

export const metadata: Metadata = {
  title: "Llavero",
  description:
    "Convierte tus diseños vectorizados o texto en llaveros listos para imprimir en 3D. Todo en tu navegador.",
};

export default function LlaveroPage() {
  return <KeychainTool />;
}
