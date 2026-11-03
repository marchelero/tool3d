import type { Metadata } from "next";
import { CortadorV2Tool } from "@/components/tools/cortador-v2/cortador-v2-tool";

export const metadata: Metadata = {
  title: "Cortador v2",
  description:
    "Separá un STL o 3MF por regiones con varita inteligente, perímetro 3D ajustable, tapas planas o curvas, encastres con tolerancias y validación de sólidos. Todo en tu navegador.",
};

export default function CortadorV2Page() {
  return <CortadorV2Tool />;
}
