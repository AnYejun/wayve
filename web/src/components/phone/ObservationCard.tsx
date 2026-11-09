// One observation, rendered for the phone: what the model (or person) saw, how sure it is, and which incident it joined.
// Model output always carries AiTag + confidence; manual entries carry "Manual".
import { EyeOff, Link2, Users } from 'lucide-react';
import {
  CROWD_LABEL, INCIDENT_LABEL, SEVERITY_LABEL,
  type HazardType, type Incident, type IncidentType, type Observation,
} from '@shared/contracts';
import { AiTag, Confidence, IncidentGlyph, ModalityTag } from '@/components/bits';
import { ago, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { CARD } from './common';

export const HAZARD_TO_INCIDENT: Record<HazardType, IncidentType> = {
  fire_smoke: 'fire_smoke', spill: 'spill', obstruction: 'obstruction', fall_injury: 'medical', fight: 'fight',
  medical: 'medical', crowd_crush: 'overcrowding', suspicious_item: 'suspicious_item', other: 'other',
};
const HAZARD_LABEL: Partial<Record<HazardType, string>> = { fall_injury: 'Fall / injury', crowd_crush: 'Crush risk' };
export const hazardLabel = (t: HazardType) => HAZARD_LABEL[t] ?? INCIDENT_LABEL[HAZARD_TO_INCIDENT[t]];

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

export function ObservationCard({ obs, incidents, zoneName, className, title }: {
  obs: Observation; incidents: Incident[]; zoneName?: string | null; className?: string; title?: string;
}) {
  const now = useNow(1000);
  const p = obs.payload;
  const linked = incidents.filter((i) => obs.incidentIds.includes(i.id));

  return (
    <article className={cn(CARD, 'p-4', className)} aria-label={title ?? 'Latest observation'}>
      <header className="mb-2.5 flex items-center gap-2 text-[13px] text-fg-2">
        <ModalityTag modality={obs.modality} />
        {zoneName ? <span className="truncate">{zoneName}</span> : null}
        <span className="ml-auto shrink-0 tabular-nums">{ago(obs.observedAt, now)}</span>
      </header>

      {p.kind === 'vision' ? (
        <>
          {!p.scene_ok ? (
            <p className="mb-2 flex items-center gap-2 rounded-[10px] bg-[rgb(198_130_75/.1)] px-3 py-2 text-[14px] font-medium text-st-crowded-fg">
              <EyeOff className="size-4 shrink-0" strokeWidth={1.75} />Too dark or blocked to see
            </p>
          ) : null}
          <p className="text-[16px] leading-6 text-fg">{p.summary || 'No description.'}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[rgb(23_21_15/.05)] px-2.5 text-[13px] font-medium text-fg">
              <Users className="size-3.5 text-fg-2" strokeWidth={1.75} />{CROWD_LABEL[p.crowd_level]}
              <span className="text-fg-2 tabular-nums">· ~{p.people_count} people</span>
            </span>
            {p.queue_present ? <span className="inline-flex h-7 items-center rounded-full bg-[rgb(23_21_15/.05)] px-2.5 text-[13px] font-medium text-fg-2">Queue</span> : null}
          </div>
          {p.hazards.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {p.hazards.map((h, i) => {
                const t = HAZARD_TO_INCIDENT[h.type];
                const sev = h.confidence >= 0.6 ? 'high' : 'medium';
                return (
                  <li key={i} className="flex items-start gap-2.5">
                    <IncidentGlyph type={t} severity={sev} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold leading-5 text-fg">{hazardLabel(h.type)}</p>
                      {h.detail ? <p className="text-[13px] leading-[18px] text-fg-2">{h.detail}</p> : null}
                    </div>
                    <span className="shrink-0 pt-0.5 text-[12px] tabular-nums text-fg-2">{Math.round(h.confidence * 100)}%</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : p.kind === 'report' ? (
        <>
          {p.transcript ? <blockquote className="mb-2 border-l-2 border-[rgb(23_21_15/.15)] pl-3 text-[15px] leading-[22px] text-fg-2">“{p.transcript}”</blockquote> : null}
          <p className="text-[16px] leading-6 text-fg">{p.summary || 'No summary.'}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 items-center rounded-full bg-[rgb(23_21_15/.05)] px-2.5 text-[13px] font-medium text-fg">
              {p.issue_type === 'none' ? 'Nothing unusual' : INCIDENT_LABEL[p.issue_type]}
            </span>
            {p.crowd_level ? <span className="inline-flex h-7 items-center rounded-full bg-[rgb(23_21_15/.05)] px-2.5 text-[13px] font-medium text-fg-2">{CROWD_LABEL[p.crowd_level]}</span> : null}
          </div>
        </>
      ) : (
        <>
          <p className="text-[16px] leading-6 text-fg">
            {[p.crowd_level ? `Crowd: ${CROWD_LABEL[p.crowd_level]}` : null, p.issue_type ? INCIDENT_LABEL[p.issue_type] : null].filter(Boolean).join(' · ') || 'Manual observation'}
          </p>
          {p.note ? <p className="mt-1 text-[15px] leading-[22px] text-fg-2">{p.note}</p> : null}
        </>
      )}

      <footer className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[rgb(23_21_15/.08)] pt-3">
        {obs.modality === 'manual' ? (
          <span className="text-[12px] font-medium text-fg-2">Entered by a person</span>
        ) : (
          <>
            <Confidence value={obs.confidence} />
            <AiTag model={obs.model} />
            {obs.latencyMs != null ? <span className="text-[12px] tabular-nums text-fg-3">{secs(obs.latencyMs)}</span> : null}
          </>
        )}
      </footer>

      {linked.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {linked.map((inc) => (
            <li key={inc.id} className="flex items-center gap-2 rounded-[10px] bg-[rgb(23_21_15/.04)] px-3 py-2 text-[14px] text-fg">
              <Link2 className="size-4 shrink-0 text-fg-2" strokeWidth={1.75} />
              <span className="min-w-0 truncate">
                Linked to incident · <b className="font-semibold">{INCIDENT_LABEL[inc.incidentType]}</b> ({SEVERITY_LABEL[inc.severity]})
              </span>
              {inc.evidenceCount > 1 ? <span className="ml-auto shrink-0 text-[12px] tabular-nums text-fg-2">{inc.evidenceCount} sources</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
