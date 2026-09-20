import type { Arm, Call, Labor, Run } from './types';
import { cost, percentile } from './measurement';

export function summarize(run: Run) {
  const calls = new Map(run.calls.map(c => [c.id,c]));
  if (calls.size !== run.calls.length) throw new Error('Duplicate usage IDs.');
  const arms = Object.fromEntries((['sift','all_ai'] as const).map(arm => {
    const rows = run.pairs;
    const shared = arm === 'sift' || run.baseline_kind === 'shared_extraction';
    const extractionFailed = (p: typeof rows[number]) => shared && !!p.extraction.error;
    const elapsed = (p: typeof rows[number]) => (shared ? p.extraction.latency_ms : 0) + p[arm].latency_ms;
    const selected = [...new Set(rows.flatMap(p => [...(shared ? p.extraction.call_ids : []), ...p[arm].call_ids]))].map(id => {
      const c = calls.get(id); if (!c) throw new Error('Missing referenced usage.'); return c;
    });
    const estimates = selected.map(c => cost(c,run.prices));
    const missing = estimates.filter(c => c.usd === null).length;
    const subtotal = estimates.reduce((n,c) => n+(c.usd ?? 0),0);
    // An aborted in-flight call not attached to a pair still belongs in actual experiment spend.
    const complete = rows.length === run.selected_cases && run.status === 'completed';
    const priced = selected.length > 0 && missing === 0 && complete;
    const errors = rows.filter(p => extractionFailed(p) || p[arm].error || p[arm].assessment === null).length;
    const correct = rows.filter(p => !extractionFailed(p) && !p[arm].error && p[arm].assessment === p.expected).length;
    const valid = rows.filter(p => p.expected === 'matched');
    const invalid = rows.filter(p => p.expected !== 'matched');
    const validMatches = valid.filter(p => !p[arm].error && p[arm].assessment === 'matched').length;
    const unsafe = invalid.filter(p => !p[arm].error && p[arm].assessment === 'matched').length;
    const matched = rows.filter(p => !extractionFailed(p) && !p[arm].error && p[arm].assessment === 'matched').length;
    const exception = rows.length - matched;
    const stage = rows.filter(p => !extractionFailed(p)).map(p => p[arm].latency_ms);
    const endToEnd = rows.map(elapsed);
    const successTimes = rows.filter(p => !extractionFailed(p) && !p[arm].error).map(elapsed);
    const labor = run.labor && complete ? laborEstimate(run.labor,matched,exception) : null;
    return [arm, {
      attempts: rows.length, errors, correct, valid_cases: valid.length, valid_matches: validMatches,
      nonmatch_cases: invalid.length, unsafe_matches: unsafe, matched, exceptions: exception,
      decision_median_ms: percentile(stage,.5), decision_p95_ms: percentile(stage,.95), decision_n: stage.length,
      e2e_median_ms: percentile(endToEnd,.5), e2e_p95_ms: percentile(endToEnd,.95), e2e_n: endToEnd.length,
      successful_e2e_median_ms: percentile(successTimes,.5), successful_e2e_n: successTimes.length,
      modeled_serial_total_ms: endToEnd.reduce((a,b)=>a+b,0),
      calls: selected.length, priced_calls: selected.length-missing,
      known_cost_subtotal_usd: subtotal, estimated_total_usd: priced ? subtotal : null,
      cost_per_attempt_usd: priced && rows.length ? subtotal/rows.length : null,
      cost_per_correct_valid_match_usd: priced && validMatches ? subtotal/validMatches : null,
      input_tokens: selected.every(c=>c.input_tokens!==null) ? selected.reduce((n,c)=>n+c.input_tokens!,0) : null,
      output_tokens: selected.every(c=>c.output_tokens!==null) ? selected.reduce((n,c)=>n+c.output_tokens!,0) : null,
      labor,
    }];
  })) as Record<Arm, {
    attempts:number; errors:number; correct:number; valid_cases:number; valid_matches:number;
    nonmatch_cases:number; unsafe_matches:number; matched:number; exceptions:number;
    decision_median_ms:number|null; decision_p95_ms:number|null; decision_n:number;
    e2e_median_ms:number|null; e2e_p95_ms:number|null; e2e_n:number;
    successful_e2e_median_ms:number|null; successful_e2e_n:number;
    modeled_serial_total_ms:number; calls:number; priced_calls:number;
    known_cost_subtotal_usd:number; estimated_total_usd:number|null;
    cost_per_attempt_usd:number|null; cost_per_correct_valid_match_usd:number|null;
    input_tokens:number|null; output_tokens:number|null;
    labor:ReturnType<typeof laborEstimate>|null;
  }>;
  const complete = run.status === 'completed' && run.pairs.length === run.selected_cases;
  const noErrors = arms.sift.errors === 0 && arms.all_ai.errors === 0;
  const eligible = complete && noErrors && run.reviewed && run.selected_cases === run.planned_cases &&
    arms.sift.unsafe_matches === 0 && arms.sift.correct >= arms.all_ai.correct && arms.sift.valid_matches >= arms.all_ai.valid_matches;
  const relative = (s:number|null,b:number|null) => s!==null && b!==null && b>0 ? (b-s)/b*100 : null;
  const paired = run.pairs.filter(p => !p.extraction.error && !p.sift.error && !p.all_ai.error);
  const deltas = paired.map(p => p.all_ai.latency_ms-p.sift.latency_ms-(run.baseline_kind === 'direct_pdf' ? p.extraction.latency_ms : 0));
  const pricedPairs=paired.flatMap(p=>{
    const ids=(arm:Arm)=>[...new Set([...(arm==='sift'||run.baseline_kind==='shared_extraction'?p.extraction.call_ids:[]),...p[arm].call_ids])];
    const totals=(arm:Arm)=>{
      const values=ids(arm).map(id=>cost(calls.get(id)!,run.prices).usd);
      return values.length&&values.every(x=>x!==null)?values.reduce<number>((n,x)=>n+x!,0):null;
    };
    const sift=totals('sift'),all_ai=totals('all_ai');
    return sift!==null&&all_ai!==null?[{sift,all_ai}]:[];
  });
  const pairedSift=pricedPairs.length?pricedPairs.reduce((n,p)=>n+p.sift,0)/pricedPairs.length:null;
  const pairedAi=pricedPairs.length?pricedPairs.reduce((n,p)=>n+p.all_ai,0)/pricedPairs.length:null;
  const experimentCosts = run.calls.map(c=>cost(c,run.prices).usd);
  return { arms, headline_eligible:eligible,
    observed_serial_latency_difference_percent:complete && noErrors ? relative(arms.sift.modeled_serial_total_ms,arms.all_ai.modeled_serial_total_ms) : null,
    observed_cost_difference_percent:complete && noErrors ? relative(arms.sift.estimated_total_usd,arms.all_ai.estimated_total_usd) : null,
    cost_saving_percent: eligible ? relative(arms.sift.estimated_total_usd,arms.all_ai.estimated_total_usd) : null,
    serial_latency_saving_percent: eligible ? relative(arms.sift.modeled_serial_total_ms,arms.all_ai.modeled_serial_total_ms) : null,
    paired_successes: paired.length, paired_decision_delta_median_ms: percentile(deltas,.5),
    paired_priced_successes:pricedPairs.length,paired_sift_cost_per_case_usd:pairedSift,paired_ai_cost_per_case_usd:pairedAi,
    paired_success_cost_difference_percent:relative(pairedSift,pairedAi),
    experiment_calls: run.calls.length,
    experiment_estimated_usd: run.calls.length && experimentCosts.every(c=>c!==null) ? experimentCosts.reduce<number>((n,c)=>n+c!,0) : null,
  };
}

export function laborEstimate(a:Labor, matched:number, exceptions:number) {
  const manual = (matched+exceptions)*a.manual_seconds_per_claim;
  const assisted = matched*a.matched_seconds_per_claim+exceptions*a.exception_seconds_per_claim;
  return { manual_seconds:manual, assisted_seconds:assisted, seconds_saved:manual-assisted,
    labor_usd_saved:(manual-assisted)/3600*a.hourly_usd };
}
export function validateLabor(v:unknown): Labor {
  const a=v as Labor;
  if (!a || typeof a.source!=='string' || !a.source.trim() ||
    [a.manual_seconds_per_claim,a.matched_seconds_per_claim,a.exception_seconds_per_claim,a.hourly_usd].some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0)) throw new Error('Invalid labor assumptions.');
  return a;
}
const num = (x:number|null,d=2) => x===null?'N/A':x.toFixed(d);
const money = (x:number|null) => x===null?'N/A':`$${x.toFixed(6)}`;
const percent = (x:number|null) => x===null?'N/A':`${x.toFixed(2)}%`;
export function report(run:Run):string {
  const s=summarize(run), a=s.arms.sift,b=s.arms.all_ai;
  const row=(label:string,x:unknown,y:unknown)=>`| ${label} | ${x} | ${y} |`;
  const lines=[ '# Sift versus all-AI: cost and time', '',
    `Status: **${run.status}**. ${run.pairs.length}/${run.selected_cases} selected cases; ${run.planned_cases} in full dataset. Labels: **${run.reviewed?'human reviewed':'UNREVIEWED — exploratory only'}**.`,
    `Commit: ${run.commit}. Started: ${run.started_at}. Baseline deployment/model: ${run.baseline_model}.`, '',
    run.baseline_kind === 'direct_pdf' ? 'Sift runs actual PDF extraction followed by production CoreService/code/Jev with isolated memory storage. The direct-AI baseline independently reads each PDF, extracts fields and returns all checks/verdict in ONE call. Each arm accumulates its own prior extracted receipts in the same original order; baseline receives all its prior receipts and Sift uses production candidate filtering. Neither arm sees expected labels or the other arm’s extractions. No Ramp system was tested.' : 'Both arms share extraction and evidence; the baseline uses a general LLM for all checks.',
    'Serial concurrency 1; alternating whole-pipeline order; no discarded warmups. Sift total is extraction + reconciliation; direct-AI total is its single PDF-to-verdict call. Timings exclude upload/network-to-app/database/UI/human time. Sift reconciliation includes local candidate retrieval. These are not hosted application throughput measurements.', '',
    '| Metric | Sift: code + Jev | Direct PDF-to-verdict AI |','| --- | ---: | ---: |',
    row('Attempts',a.attempts,b.attempts),row('Errors (retained)',a.errors,b.errors),
    row('Correct assessments',`${a.correct}/${a.attempts}`,`${b.correct}/${b.attempts}`),
    row('Correct valid matches',`${a.valid_matches}/${a.valid_cases}`,`${b.valid_matches}/${b.valid_cases}`),
    row('Unsafe matches',`${a.unsafe_matches}/${a.nonmatch_cases}`,`${b.unsafe_matches}/${b.nonmatch_cases}`),
    row('Cases requiring exception handling',a.exceptions,b.exceptions),
    row('Reconciliation / direct-AI call median / p95 (ms)',`${num(a.decision_median_ms)} / ${num(a.decision_p95_ms)} (n=${a.decision_n})`,`${num(b.decision_median_ms)} / ${num(b.decision_p95_ms)} (n=${b.decision_n})`),
    row('Receipt-to-verdict median / p95 (ms)',`${num(a.e2e_median_ms)} / ${num(a.e2e_p95_ms)} (n=${a.e2e_n})`,`${num(b.e2e_median_ms)} / ${num(b.e2e_p95_ms)} (n=${b.e2e_n})`),
    row('Successful receipt-to-verdict median (ms)',`${num(a.successful_e2e_median_ms)} (n=${a.successful_e2e_n})`,`${num(b.successful_e2e_median_ms)} (n=${b.successful_e2e_n})`),
    row('Provider attempts, including extraction',a.calls,b.calls),row('Input / output tokens',`${a.input_tokens??'unknown'} / ${a.output_tokens??'unknown'}`,`${b.input_tokens??'unknown'} / ${b.output_tokens??'unknown'}`),
    row('Price coverage',`${a.priced_calls}/${a.calls} calls`,`${b.priced_calls}/${b.calls} calls`),
    row('Known cost subtotal (not total)',a.priced_calls?money(a.known_cost_subtotal_usd):'N/A',b.priced_calls?money(b.known_cost_subtotal_usd):'N/A'),
    row('Estimated model cost, full total',money(a.estimated_total_usd),money(b.estimated_total_usd)),
    row('Estimated model cost / attempted receipt',money(a.cost_per_attempt_usd),money(b.cost_per_attempt_usd)),
    row('Estimated model cost / correct valid match',money(a.cost_per_correct_valid_match_usd),money(b.cost_per_correct_valid_match_usd)), '',
    `Paired successful cases: ${s.paired_successes}; median per-pair receipt-to-verdict time difference (AI minus Sift): ${num(s.paired_decision_delta_median_ms)} ms.`,
    `Actual experiment: ${s.experiment_calls} provider attempts, ${money(s.experiment_estimated_usd)} estimated cost. Each actual call is counted once here. Billed dollars are not measured.`, '',
    `Successfully processed, fully priced pairs ONLY (n=${s.paired_priced_successes}): mean Sift cost ${money(s.paired_sift_cost_per_case_usd)} per receipt; direct-AI ${money(s.paired_ai_cost_per_case_usd)}. Cost difference ${percent(s.paired_success_cost_difference_percent)}. This excludes failed/unpriced pairs and must not be described as total-run savings. Success means a valid response, not a correct verdict.`, '',
    `Observed serial processing-time difference: ${percent(s.observed_serial_latency_difference_percent)}. Observed estimated-cost difference: ${percent(s.observed_cost_difference_percent)}. Positive means Sift used less; negative means more. These descriptive comparisons do not establish equal decision quality.`, '',
    '**Presentation claim gate:** '+(s.headline_eligible ? 'Passed: full reviewed run, no errors, zero Sift unsafe matches, and no lower observed correctness or valid-match yield than the baseline. This is not statistical proof of equivalence.' : 'BLOCKED. Require a complete, reviewed full dataset, no errors, zero Sift unsafe matches, and no worse observed correctness or valid-match yield than the baseline. Raw results remain above.'),
    `Eligible cost reduction: ${percent(s.cost_saving_percent)}. Eligible modeled serial processing-time reduction: ${percent(s.serial_latency_saving_percent)}. Negative values mean Sift was worse. Missing prices never become zero cost.`, '',
    '### Human time and money', '',
    'All current Sift claims still require human approval. Matched cases are not assumed to need zero human time. Labor savings below, if supplied, are a scenario using explicit assumptions, not observed reviewer savings or competitor measurements.',
  ];
  const stageRows=(['extraction','sift','all_ai'] as const).map(stage=>{
    const calls=run.calls.filter(c=>c.stage===stage),times=calls.map(c=>c.latency_ms);
    const costs=calls.map(c=>cost(c,run.prices).usd);
    return `| ${stage==='extraction'?'Sift extraction':stage==='sift'?'Sift Jev':'Direct PDF-to-verdict AI'} | ${calls.length} | ${num(percentile(times,.5))} | ${num(percentile(times,.95))} | ${calls.length&&costs.every(c=>c!==null)?money(costs.reduce<number>((n,c)=>n+c!,0)):'N/A'} |`;
  });
  const humanIndex=lines.indexOf('### Human time and money');
  lines.splice(humanIndex,0,'### Provider stage breakdown','', '| Stage | Attempts | Median ms | p95 ms | Estimated model cost |','| --- | ---: | ---: | ---: | ---: |',...stageRows,'','Per-call provider round-trip timings; Sift code/retrieval overhead is included in the reconciliation timing above. These stage costs sum to the actual experiment, not one pipeline.','');
  const pricesIndex=lines.indexOf('### Human time and money');
  lines.splice(pricesIndex,0,'### Price assumptions','',...run.prices.map(p=>`- ${p.provider} / ${p.requested_model} → ${p.returned_model}: ${p.sku}; ${p.region}. USD per million: input ${p.input_usd_per_million}, output ${p.output_usd_per_million}, cached ${p.cached_input_usd_per_million}, cache write ${p.cache_write_usd_per_million??'unspecified'} (${p.cache_write_accounting??'unspecified'}). [Source](${p.source_url}), checked ${p.checked_at}.`),'');
  if(run.labor) {
    lines.push(`Assumptions: ${JSON.stringify(run.labor)}`, '', '| Scenario | Sift | All-AI |','| --- | ---: | ---: |',
      row('Estimated manual-review seconds saved',a.labor?num(a.labor.seconds_saved):'N/A',b.labor?num(b.labor.seconds_saved):'N/A'),
      row('Estimated labor dollars saved',a.labor?money(a.labor.labor_usd_saved):'N/A',b.labor?money(b.labor.labor_usd_saved):'N/A'));
  } else lines.push('Not supplied; no human time or labor-dollar savings claimed.');
  lines.push('', '### Limitations', '', ...run.limitations.map(x=>`- ${x}`),
    '- Price estimates exclude hosting, storage, development agents, tax and reviewer labor. Deployment names require explicit SKU/region/model mappings. Pricing file is preserved with the run.',
    '- Provider failures and malformed outputs remain errors; retry attempts count. Unknown token/cache breakdowns suppress affected cost totals.',
    run.assessment_policy==='fail-first-v2'?'- This run uses fail-first aggregation and production confirmed-duplicate detection. The baseline receives the same byte hashes and instructions. Jev thresholds remain .70/.85.':'- Historical run used unknown-first aggregation. Its results do not describe the newer fail-first/confirmed-duplicate implementation.',
    '- A small synthetic run does not establish production accuracy, statistical equivalence, or Ramp savings.');
  return lines.join('\n')+'\n';
}

function csv(values:unknown[]) { return values.map(x=>`"${String(x??'').replaceAll('"','""')}"`).join(','); }
export function casesCsv(run:Run):string {
  return [csv(['case_id','cohort','expected','first','extraction_ms','sift_assessment','ai_assessment','sift_error','ai_error','sift_decision_ms','ai_decision_ms','sift_e2e_ms','ai_e2e_ms']),
    ...run.pairs.map(p=>csv([p.case_id,p.cohort,p.expected,p.first,p.extraction.latency_ms,p.sift.assessment,p.all_ai.assessment,p.sift.error,p.all_ai.error,p.sift.latency_ms,p.all_ai.latency_ms,p.extraction.latency_ms+p.sift.latency_ms,(run.baseline_kind==='shared_extraction'?p.extraction.latency_ms:0)+p.all_ai.latency_ms]))].join('\n')+'\n';
}
export function callsJsonl(calls:Call[]) {return calls.map(c=>JSON.stringify(c)).join('\n')+'\n';}
