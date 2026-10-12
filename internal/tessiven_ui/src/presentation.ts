import type { CanvasDocument, RenderModel, RenderVersion, Version } from './types';
import { presentationCapabilities, presentationFormat } from './native/contract';

// Desktop and Env App keep their editing document contract. Only this boundary
// translates those validated documents into the shared display-only model.
export function toRenderModel(document: CanvasDocument): RenderModel {
  const { metadata, nodes, groups, services, instances, resources, relations, evidence, presentation } = document;
  return { metadata, nodes, groups, services, instances, resources, relations, evidence, presentation };
}

export function toRenderVersion(version: Version): RenderVersion {
  return {
    canvas_id: version.canvas_id,
    number: version.number,
    source: version.source,
    view: {
      format: presentationFormat,
      model: toRenderModel(version.document),
      capabilities: [...presentationCapabilities],
      compatibility: { status: 'complete', limitations: [] },
    },
  };
}
