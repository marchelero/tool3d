import type { Metadata } from "next";
import { TexturizerTool } from "@/components/tools/texturizador/texturizer-tool";

export const metadata: Metadata = {
  title: "Texturizador STL",
  description:
    "Cargá un STL y aplicá texturas de relieve reales: proyección triplanar, máscaras y exportación STL. Todo en tu navegador.",
};

export default function TexturizadorPage() {
  return <TexturizerTool />;
}
