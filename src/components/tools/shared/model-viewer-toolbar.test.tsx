import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Rotate3d } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { StandardModelViewerToolbar } from "./model-viewer-toolbar";

type ButtonProps = {
  "aria-label": string;
  "aria-pressed"?: boolean;
  onClick: () => void;
  children?: ReactNode;
};

function buttonsIn(node: ReactNode): Array<ReactElement<ButtonProps>> {
  if (Array.isArray(node)) return node.flatMap(buttonsIn);
  if (!isValidElement(node)) return [];

  const element = node as ReactElement<ButtonProps>;
  if (typeof element.type === "function") {
    const renderComponent = element.type as (props: typeof element.props) => ReactNode;
    return buttonsIn(renderComponent(element.props));
  }
  const children = buttonsIn(element.props.children);
  return element.type === "button" ? [element, ...children] : children;
}

describe("StandardModelViewerToolbar", () => {
  it("exposes shared view actions and dispatches callbacks", () => {
    const onToggleExpanded = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onCenter = vi.fn();
    const onViewPreset = vi.fn();
    const onToggleGrid = vi.fn();
    const onToggleWireframe = vi.fn();
    const onExtraAction = vi.fn();
    const element = StandardModelViewerToolbar({
      expanded: false,
      onToggleExpanded,
      onZoomIn,
      onZoomOut,
      onCenter,
      onViewPreset,
      gridVisible: true,
      onToggleGrid,
      wireframeVisible: false,
      onToggleWireframe,
      extraActions: [{ id: "auto-rotate", label: "Rotación automática", icon: <Rotate3d />, onClick: onExtraAction }],
    });
    const buttons = buttonsIn(element);
    const button = (label: string) => {
      const found = buttons.find((candidate) => candidate.props["aria-label"] === label);
      expect(found, `missing button ${label}`).toBeDefined();
      return found!;
    };

    button("Expandir visor").props.onClick();
    button("Acercar").props.onClick();
    button("Alejar").props.onClick();
    button("Centrar modelo").props.onClick();
    button("Vista superior").props.onClick();
    button("Ocultar cuadrícula").props.onClick();
    button("Activar alambre").props.onClick();
    button("Rotación automática").props.onClick();

    expect(onToggleExpanded).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onCenter).toHaveBeenCalledOnce();
    expect(onViewPreset).toHaveBeenCalledWith("top");
    expect(onToggleGrid).toHaveBeenCalledOnce();
    expect(onToggleWireframe).toHaveBeenCalledOnce();
    expect(onExtraAction).toHaveBeenCalledOnce();
    expect(button("Ocultar cuadrícula").props["aria-pressed"]).toBe(true);
    expect(button("Activar alambre").props["aria-pressed"]).toBe(false);
  });

  it("renames the fullscreen action when already expanded", () => {
    const element = StandardModelViewerToolbar({
      expanded: true,
      onToggleExpanded: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onCenter: vi.fn(),
      onViewPreset: vi.fn(),
      gridVisible: false,
      onToggleGrid: vi.fn(),
      wireframeVisible: true,
      onToggleWireframe: vi.fn(),
    });
    const labels = buttonsIn(element).map((button) => button.props["aria-label"]);
    expect(labels).toContain("Restaurar visor");
    expect(labels).not.toContain("Expandir visor");
  });
});
