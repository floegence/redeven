import type { Definition, FlowNode } from './api';
export type Starter = 'blank' | 'news' | 'inspection';
const reportTemplate =
  '<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;max-width:960px;margin:48px auto;padding:0 24px;color:#172234;line-height:1.6}header{border-bottom:2px solid #172234}article{margin:24px 0}a{color:#1558a6}pre{white-space:pre-wrap}</style></head><body><header><h1>{{.Title}}</h1><p>{{.ScheduledAt}}</p></header>{{range $step,$values := .Inputs}}{{range $values}}<article>{{if .headline}}<h2>{{.headline}}</h2>{{end}}{{if .summary}}<p>{{.summary}}</p>{{end}}{{if .findings}}{{range .findings}}<h3>{{.title}}</h3><p>{{.detail}}</p>{{end}}{{end}}{{if .sources}}<ul>{{range .sources}}<li><a href="{{.url}}">{{.title}}</a></li>{{end}}</ul>{{end}}{{if .gaps}}<pre>{{.gaps}}</pre>{{end}}</article>{{end}}{{end}}</body></html>';
export function starterDefinition(
  kind: Starter,
  translateAutomation: (key: string) => string,
  model: string,
  directory: string,
): Definition {
  const base: Definition = {
    title: translateAutomation(kind === 'blank' ? 'workflow' : kind),
    goal: translateAutomation(kind === 'blank' ? 'goal' : `${kind}Goal`),
    model,
    working_directory: directory,
    max_concurrent: 3,
    timeout_seconds: 1800,
    allow_partial: false,
    nodes: [],
  };
  const resultSchema = {
    type: 'object',
    required: ['headline', 'summary', 'findings', 'sources', 'gaps'],
    properties: {
      headline: { type: 'string' },
      summary: { type: 'string' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'detail'],
          properties: { title: { type: 'string' }, detail: { type: 'string' } },
        },
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'url'],
          properties: { title: { type: 'string' }, url: { type: 'string' } },
        },
      },
      gaps: { type: 'array', items: { type: 'string' } },
    },
  };
  const report: FlowNode = {
    id: 'report',
    title: translateAutomation('kinds.render'),
    kind: 'render',
    depends_on: ['synthesis'],
    template: reportTemplate,
  };
  const deliver: FlowNode = {
    id: 'delivery',
    title: translateAutomation('kinds.deliver'),
    kind: 'deliver',
    depends_on: ['report'],
    tool: 'artifact.save',
    require_review: true,
  };
  if (kind === 'blank') {
    base.nodes = [
      {
        id: 'task',
        title: translateAutomation('kinds.agent'),
        kind: 'agent',
        depends_on: [],
        instruction: '',
        output_schema: { type: 'object' },
      },
    ];
    return base;
  }
  if (kind === 'news')
    base.nodes = [
      {
        id: 'sources',
        title: translateAutomation('newsSources'),
        kind: 'agent',
        depends_on: [],
        instruction:
          'Identify relevant news within the scheduled daily window. Fetch original sources. Return a deduplicated array of {id,label,data:{url,title,published_at}}. Stable IDs must use source identity. Do not fabricate inaccessible sources.',
        output_schema: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'label', 'data'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              data: { type: 'object' },
            },
          },
        },
      },
      {
        id: 'research',
        title: translateAutomation('newsResearch'),
        kind: 'parallel',
        depends_on: ['sources'],
        items_from: 'sources',
        concurrency: 3,
        instruction:
          'Investigate the assigned source using original material. Read the shared workflow context, verify publication dates and distinguish confirmed facts from claims. Return title, detail, sources, and explicit uncertainty.',
        output_schema: { type: 'object' },
      },
      {
        id: 'coverage',
        title: translateAutomation('kinds.join'),
        kind: 'join',
        depends_on: ['research'],
        join_policy: 'all',
      },
      {
        id: 'synthesis',
        title: translateAutomation('newsSynthesis'),
        kind: 'agent',
        depends_on: ['coverage'],
        instruction:
          'Read all source results and coverage in the workflow context. Deduplicate stories, verify major claims and cite original URLs. Produce the agreed report structure. Explicitly list missing sources and unresolved claims in gaps.',
        output_schema: resultSchema,
      },
      report,
      deliver,
    ];
  if (kind === 'inspection')
    base.nodes = [
      {
        id: 'inspect',
        title: translateAutomation('inspectionTargets'),
        kind: 'parallel',
        depends_on: [],
        items: [],
        concurrency: 3,
        instruction:
          'Inspect only the assigned cluster using its explicit connection and permitted read-only tools. Record observation time, cluster ID, availability, workload status and findings. Never mark inaccessible targets healthy. Do not modify infrastructure.',
        output_schema: {
          type: 'object',
          required: ['cluster_id', 'observed_at', 'status', 'findings'],
          properties: {
            cluster_id: { type: 'string' },
            observed_at: { type: 'string' },
            status: { enum: ['healthy', 'degraded', 'unavailable'] },
            findings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      {
        id: 'coverage',
        title: translateAutomation('kinds.join'),
        kind: 'join',
        depends_on: ['inspect'],
        join_policy: 'partial',
        minimum_success: 1,
      },
      {
        id: 'synthesis',
        title: translateAutomation('inspectionSynthesis'),
        kind: 'agent',
        depends_on: ['coverage'],
        instruction:
          'Read the coverage record and every cluster result from workflow context. Produce a fixed-format inspection report. Include observed time, per-cluster health, completed/total coverage and unavailable targets. Missing evidence must remain a coverage gap. Do not infer health from task completion.',
        output_schema: resultSchema,
      },
      report,
      deliver,
    ];
  base.allow_partial = kind === 'inspection';
  return base;
}
