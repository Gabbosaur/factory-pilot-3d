'use client';
/** Photo → AI visual inspection (multimodal model on AMD Token Factory), shared by quality-hold sampling and incident evidence. */
import { useStore } from '@/modules/store';
import { enqueuePost } from '@/modules/incidents/requestQueue';
import type { InspectionResult, LlmCallMeta, MachineConfig } from '@/shared/types';

export const DEFECT_LABEL: Record<InspectionResult['defect_type'], string> = {
  none: 'No defect',
  cap_missing: 'Cap missing',
  cap_crooked: 'Crooked cap',
  cap_loose: 'Loose cap',
  fill_low: 'Fill level too low',
  fill_high: 'Fill level too high',
  label_defect: 'Label defect',
  container_damage: 'Container damage',
  foreign_object: 'Foreign object',
  other: 'Other defect',
};

/** Downscale to at most `maxSide` px and re-encode as JPEG: smaller request, faster model, light thumbnails. */
export async function toDataUrl(file: File, maxSide = 1024, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export interface PhotoInspection {
  thumb: string;
  result?: InspectionResult;
  meta?: LlmCallMeta;
  error?: string;
}

export async function inspectPhoto(file: File, machine: Pick<MachineConfig, 'id' | 'name' | 'type'>, note?: string): Promise<PhotoInspection> {
  let image: string;
  let thumb: string;
  try {
    image = await toDataUrl(file);
    thumb = await toDataUrl(file, 160, 0.7);
  } catch {
    return { thumb: '', error: 'Could not read the image' };
  }
  const st = useStore.getState();
  const res = await enqueuePost<InspectionResult>('/api/inspect', { image, machine: { id: machine.id, name: machine.name, type: machine.type }, note, replay: st.replay });
  if (!res.ok) return { thumb, error: res.error };
  if (res.meta) st.logLlm(res.meta);
  return { thumb, result: res.data, meta: res.meta };
}

export const describeInspection = (r: InspectionResult) =>
  `AI visual inspection: ${r.verdict} · ${DEFECT_LABEL[r.defect_type]} (${Math.round(r.confidence * 100)}%)${r.affects_quality ? ' · do not ship as is' : ''}`;
