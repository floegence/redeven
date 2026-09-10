#!/usr/bin/env python3
"""Generate the offline Flower catalog. Network access requires --update."""
import argparse
import datetime
import urllib.parse
import hashlib
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / 'scripts/model-catalog'
OUTPUT = ROOT / 'internal/config/model_catalog.generated.json'
SOURCES = {'openai': 'openai', 'anthropic': 'anthropic', 'google': 'google',
           'moonshot': 'moonshotai-cn', 'chatglm': 'zai', 'deepseek': 'deepseek',
           'qwen': 'alibaba', 'xai': 'xai', 'groq': 'groq'}
FIELDS = ('id', 'name', 'status', 'release_date', 'tool_call', 'modalities',
          'limit', 'cost', 'reasoning', 'reasoning_options')


def snapshot(raw):
    upstream = json.loads(raw)
    return {'source': 'https://models.dev/api.json',
            'sha256': hashlib.sha256(raw).hexdigest(),
            'providers': {local: {mid: {key: value for key, value in model.items() if key in FIELDS}
                                  for mid, model in upstream[source]['models'].items()}
                          for local, source in SOURCES.items()}}


def reasoning(pid, model, rules):
    if not model.get('reasoning'):
        return {}
    options = model.get('reasoning_options', [])
    types = {o['type'] for o in options}
    if types - {'effort', 'toggle', 'budget_tokens'}:
        raise ValueError(f"{pid}/{model['id']}: review new reasoning options {types}")
    effort = next((o.get('values', []) for o in options if o['type'] == 'effort'), [])
    budget = next((o for o in options if o['type'] == 'budget_tokens'), None)
    levels = ['off' if v == 'none' else v for v in effort if v != 'default']
    cap = {'kind': 'always_on', 'source_checked_at': rules['checked_at'],
           'source_urls': rules['sources'][pid]}
    if effort:
        cap.update(kind='effort', supported_levels=levels)
    if 'toggle' in types or 'off' in levels:
        cap['disable_supported'] = True
    if budget is not None:
        cap['kind'] = 'effort_budget' if effort else ('toggle_budget' if 'toggle' in types else 'budget')
        cap['budget'] = {k + '_tokens': budget[k] for k in ['min', 'max'] if k in budget}
    elif 'toggle' in types and not effort:
        cap['kind'] = 'toggle'
    if pid in ['openai', 'google', 'groq', 'xai']:
        cap['wire_shape'] = 'openai_chat_reasoning_effort'
        if pid == 'google' and budget is not None:
            cap.update(wire_shape='gemini_openai_thinking_budget', budget_shape='gemini_thinking_budget')
    elif pid == 'anthropic':
        cap['wire_shape'] = 'anthropic_output_config_effort' if effort else 'anthropic_thinking_budget_tokens'
        if budget is not None:
            cap.update(budget_shape='anthropic_thinking_budget_tokens', disable_supported=True)
    elif pid == 'moonshot':
        cap['wire_shape'] = 'kimi_reasoning_effort' if effort else 'kimi_thinking_type'
        cap['history_replay_requirements'] = ['reasoning_content']
    elif pid == 'chatglm':
        cap['wire_shape'] = 'glm_reasoning_effort' if effort else 'glm_thinking_type'
    elif pid == 'deepseek':
        cap.update(wire_shape='deepseek_responses_reasoning_effort', history_replay_requirements=['reasoning.content'])
    elif pid == 'qwen':
        cap['wire_shape'] = 'qwen_reasoning_effort' if effort else 'qwen_enable_thinking'
        if budget is not None:
            cap['budget_shape'] = 'qwen_thinking_budget'
    cap['fixture'] = cap['wire_shape']
    return cap


SEARCH_MODES = {
    'openai': 'openai_responses_builtin', 'deepseek': 'deepseek_native',
    'moonshot': 'kimi_builtin', 'chatglm': 'glm_web_search_tool',
    'qwen': 'qwen_responses_web_search',
}


def search_declarations(rules):
    declarations = {}
    for group in rules.get('web_search', []):
        pid = group['provider']
        status = group['status']
        mode = group.get('mode', '')
        if pid not in SOURCES or status not in ['supported', 'unsupported', 'not_integrated']:
            raise ValueError(f'{pid}: invalid web search declaration')
        if (status == 'supported' and (not mode or mode != SEARCH_MODES.get(pid))) or (status != 'supported' and mode):
            raise ValueError(f'{pid}: web search mode does not match the adapter')
        sources = group.get('source_urls', [])
        if not sources or any(urllib.parse.urlparse(url).scheme != 'https' or not urllib.parse.urlparse(url).netloc for url in sources):
            raise ValueError(f'{pid}: web search requires source URLs')
        datetime.date.fromisoformat(group['source_checked_at'])
        if not group['models']:
            raise ValueError(f'{pid}: empty web search review')
        for mid in group['models']:
            key = pid + '/' + mid
            if not mid or key in declarations:
                raise ValueError(f'{key}: duplicate or empty web search model')
            declarations[key] = {key: value for key, value in group.items() if key not in ['provider', 'models']}
    return declarations


def generate(data, rules):
    result = {'source': data['source'], 'sha256': data['sha256'], 'checked_at': rules['checked_at'], 'providers': {}, 'web_search': search_declarations(rules)}
    for pid, models in data['providers'].items():
        output = []
        for mid, original in models.items():
            model = dict(original)
            model.update(rules.get('models', {}).get(pid + '/' + mid, {}).get('metadata', {}))
            if mid in rules.get('exclude', {}).get(pid, []):
                continue
            if re.search(rules['exclude_pattern'], mid) or model.get('status') == 'deprecated':
                continue
            if not model.get('tool_call') or model.get('modalities', {}).get('output') != ['text']:
                continue
            if pid == 'qwen' and not mid.startswith(('qwen', 'qwq', 'qvq')):
                continue
            if pid == 'google' and not mid.startswith('gemini-'):
                continue
            if pid + '/' + mid not in result['web_search']:
                raise ValueError(f'{pid}/{mid}: missing reviewed web search declaration')
            limits = model['limit']
            if limits.get('context', 0) <= 0 or limits.get('output', 0) <= 0:
                raise ValueError(f'{pid}/{mid}: missing token limits')
            cap = reasoning(pid, model, rules)
            cap.update(rules.get('models', {}).get(pid + '/' + mid, {}).get('reasoning', {}))
            status = model.get('status', '')
            if re.search(r'experimental|(?:^|-)exp(?:-|$)', mid):
                status = 'experimental'
            elif not status and 'preview' in mid:
                status = 'beta'
            cost = model.get('cost', {})
            output.append({'id': mid, 'name': model['name'], 'status': status,
                           'context_window': limits['context'], 'max_tokens': limits['output'],
                           'input': [x for x in model['modalities']['input'] if x in ['text', 'image']],
                           'reasoning': cap,
                           'cost': {dst: cost[src] for src, dst in [('input','input_per_mtok'),('output','output_per_mtok'),('cache_read','cache_read_per_mtok'),('cache_write','cache_write_per_mtok')] if src in cost},
                           'release_date': model.get('release_date', '')})
        output.sort(key=lambda m: (m['release_date'], m['id']), reverse=True)
        if not output:
            raise ValueError(f'{pid}: empty catalog')
        result['providers'][pid] = output
    # Both the Go resolver and Flower import this exact generated file.
    for pid, models in result['providers'].items():
        for model in models:
            wire = model.pop('id')
            local = wire.replace('%', '%25').replace('/', '%2F')
            if pid == 'groq' and wire == 'openai/gpt-oss-120b':
                local = 'gpt-oss-120b'  # Preserve the shipped routing identity.
            model['model_name'] = local
            if local != wire:
                model['wire_model_name'] = wire
            model['display_name'] = model.pop('name')
            model['max_output_tokens'] = model.pop('max_tokens')
            model['input_modalities'] = model.pop('input')
            cap = model.pop('reasoning')
            if cap:
                budget = cap.pop('budget', {})
                for key in ['min_tokens', 'max_tokens']:
                    if key in budget:
                        cap[key.replace('_tokens', '_budget_tokens')] = budget[key]
                if pid == 'openai':
                    cap['wire_shape'] = 'openai_responses_reasoning_effort'
                if pid in ['moonshot', 'chatglm', 'qwen', 'groq', 'google', 'xai']:
                    cap['response_reasoning_fields'] = ['reasoning_content']
                if pid in ['chatglm', 'qwen']:
                    cap['history_replay_requirements'] = ['reasoning_content']
                model['reasoning_capability'] = cap
            model.pop('cost')
    return result


def encoded(value):
    return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--update', action='store_true')
    group.add_argument('--source', type=pathlib.Path, help='Explicit previously downloaded models.dev API response')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    rules = json.loads((DATA / 'overrides.json').read_text())
    if args.update:
        request = urllib.request.Request('https://models.dev/api.json', headers={'User-Agent': 'Redeven model catalog updater'})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = snapshot(response.read())
    elif args.source:
        data = snapshot(args.source.read_bytes())
    else:
        data = json.loads((DATA / 'upstream.json').read_text())
    output = encoded(generate(data, rules))
    if args.check:
        if OUTPUT.read_text() != output:
            raise SystemExit('Catalog is stale. Run python3 scripts/model-catalog/generate.py')
    else:
        # Validate and render completely before replacing either file.
        (DATA / 'upstream.json').write_text(encoded(data))
        OUTPUT.write_text(output)
    print(f"Catalog: {sum(len(ms) for ms in data['providers'].values())} upstream records; SHA256 {data['sha256']}")


if __name__ == '__main__':
    main()
