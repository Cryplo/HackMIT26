/** Properties the development pack must hold before any human spends time reviewing it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from './documents';
import { buildPack, CAPS, COHORT_COUNTS, LABEL_TERMS, POLICY_WINDOW, uploadFields, type Cohort } from './pack';
import { appVisibleInputs, requireReview, writePack } from './write';

const SEED = 20260927;

test('pack has the agreed shape: 20 cases, agreed cohorts, originals before their duplicates', () => {
  const pack = buildPack(SEED);
  assert.equal(pack.length, 20);
  const counts = pack.reduce<Record<string, number>>((a, c) => ({ ...a, [c.label.cohort]: (a[c.label.cohort] ?? 0) + 1 }), {});
  assert.deepEqual(counts, COHORT_COUNTS);
  assert.equal(new Set(pack.map(c => c.case_id)).size, 20);
  for (const c of pack) {
    const dependencies = [...c.label.depends_on, ...(c.label.duplicate_of ? [c.label.duplicate_of] : [])];
    for (const id of dependencies) {
      const other = pack.find(x => x.case_id === id);
      assert.ok(other, `${c.case_id} depends on unknown case ${id}`);
      assert.ok(other!.sequence < c.sequence, `${c.case_id} must be submitted after ${id}`);
    }
  }
});

test('generation is deterministic for a seed and different across seeds', () => {
  const a = buildPack(SEED), b = buildPack(SEED), c = buildPack(SEED + 1);
  const fingerprint = (pack: ReturnType<typeof buildPack>) =>
    pack.map(x => `${x.case_id}:${sha256(Buffer.concat(x.documents.map(d => d.bytes)))}`).join('|');
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(c));
});

test('nothing application-visible leaks the expected answer', () => {
  const pack = buildPack(SEED);
  const visible = JSON.stringify(appVisibleInputs(pack)).toLowerCase();
  for (const term of LABEL_TERMS) assert.ok(!visible.includes(term.toLowerCase()), `inputs.json leaks "${term}"`);
  for (const c of pack) {
    assert.match(c.case_id, /^clm-[0-9a-f]{6}$/);
    for (const d of c.documents) {
      assert.ok(d.file.includes(c.case_id) && !LABEL_TERMS.some(t => d.file.toLowerCase().includes(t.toLowerCase())), `filename leaks intent: ${d.file}`);
      const text = d.bytes.toString('latin1').toLowerCase();
      for (const term of ['expected', 'duplicate of', 'cohort', 'policy violation', 'approve', 'reject'])
        assert.ok(!text.includes(term), `${d.file} contains evaluator language "${term}"`);
    }
    assert.deepEqual(Object.keys(uploadFields(c)).sort(), ['amount_requested_minor', 'attendee_name', 'category', 'currency', 'email', 'origin_location'].sort());
  }
});

test('documents carry the real clues the labels rely on', () => {
  const pack = buildPack(SEED);
  for (const c of pack) {
    const text = (role: string) => c.documents.filter(d => d.role === role).map(d => d.bytes.toString('latin1')).join('\n');
    const original = text('original_receipt');
    assert.ok(original.startsWith('%PDF-1.4'), `${c.case_id} original is not a PDF`);
    assert.ok(original.includes('NOT VALID FOR PAYMENT'));
    if (c.label.cohort === 'unfamiliar_linked_booking') {
      const reference = c.printed.booking_reference!;
      assert.ok(original.includes(reference) && text('supporting').includes(reference), `${c.case_id} booking reference is not on both documents`);
      assert.equal(c.input.category, 'hotel');
      assert.equal(c.input.currency, 'USD');
    }
    if (c.label.cohort === 'itinerary_identity') {
      assert.deepEqual(c.printed.names, []);
      const support = text('supporting');
      assert.ok(support.includes(c.input.attendee_name) && support.includes(c.printed.receipt_number!), `${c.case_id} itinerary does not link the claimant to the receipt`);
    }
    if (c.label.cohort === 'duplicate_purchase') {
      const original_case = pack.find(x => x.case_id === c.label.duplicate_of)!;
      assert.equal(c.printed.receipt_number, original_case.printed.receipt_number);
      assert.equal(c.printed.amount_minor, original_case.printed.amount_minor);
      assert.notEqual(sha256(c.documents[0].bytes), sha256(original_case.documents[0].bytes), 'duplicate must be a different document, not the same bytes');
    }
    if (c.label.cohort === 'incomplete') {
      assert.equal(c.documents.length, 1, 'an incomplete case must not hide the answer in a supporting document');
      assert.equal(c.printed.amount_minor, null);
      assert.equal(c.printed.receipt_date, null);
    }
    if (c.label.cohort === 'violation') assert.ok(c.input.amount_requested_minor > CAPS[c.input.category]);
  }
});

test('similar cases are genuinely distinct purchases and the pack claims one purchase each', () => {
  const pack = buildPack(SEED);
  const similar = pack.filter(c => c.label.cohort === 'similar_distinct');
  assert.equal(similar.length, 2);
  assert.equal(similar[0].printed.vendor, similar[1].printed.vendor);
  assert.equal(similar[0].printed.receipt_date, similar[1].printed.receipt_date);
  assert.equal(similar[0].printed.amount_minor, similar[1].printed.amount_minor);
  assert.notEqual(similar[0].printed.receipt_number, similar[1].printed.receipt_number);
  assert.notEqual(similar[0].printed.purchase_detail, similar[1].printed.purchase_detail);
  for (const c of pack) {
    assert.equal(c.documents.filter(d => d.role === 'original_receipt').length, 1);
    const supporting = c.documents.filter(d => d.role === 'supporting');
    for (const d of supporting) {
      const printedTotal = c.printed.amount_minor === null ? null : (c.printed.amount_minor / 100).toFixed(2);
      const text = d.bytes.toString('latin1');
      // A supporting document may repeat the same total; it may never add a second one.
      const totals = [...text.matchAll(/USD (\d+\.\d{2})/g)].map(m => m[1]);
      assert.ok(totals.every(t => t === printedTotal), `${c.case_id} supporting document introduces a second amount`);
    }
    if (c.printed.receipt_date) assert.ok(c.printed.receipt_date >= POLICY_WINDOW.start && c.printed.receipt_date <= POLICY_WINDOW.end || c.label.cohort === 'violation');
  }
});

test('written artifacts separate inputs from answers, hash everything, and refuse to overwrite', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'demo20-'));
  try {
    const manifest = await writePack(dir, SEED);
    assert.equal(manifest.case_count, 20);
    assert.equal(manifest.documents.length, buildPack(SEED).reduce((n, c) => n + c.documents.length, 0));
    for (const d of manifest.documents) assert.equal(sha256(await readFile(path.join(dir, d.file))), d.sha256);
    const inputs = await readFile(path.join(dir, 'inputs.json'), 'utf8');
    assert.equal(sha256(inputs), manifest.inputs_sha256);
    assert.ok(!/expected|cohort|rationale/i.test(inputs));
    const labels = JSON.parse(await readFile(path.join(dir, 'labels.evaluator-only.json'), 'utf8'));
    assert.equal(labels.cases.length, 20);
    assert.ok(labels.cases.every((c: { rationale: string }) => c.rationale.length > 40), 'every label needs a written reason');
    await assert.rejects(writePack(dir, SEED), /Refusing to overwrite/);

    // The pack is unreviewed until a human writes review.json; nothing here may forge that.
    await assert.rejects(requireReview(dir, path.join(dir, 'review.json')));
    const review = {
      pack_version: manifest.pack_version, reviewers: ['placeholder'], reviewed_at: '2026-09-27T00:00:00.000Z', minutes_spent: 1,
      inputs_sha256: manifest.inputs_sha256, labels_sha256: manifest.labels_sha256, policy_sha256: manifest.policy_sha256,
      corrections: [], open_disagreements: [] as { case_id: string; question: string }[]
    };
    const reviewPath = path.join(dir, 'review.json');
    await (await import('node:fs/promises')).writeFile(reviewPath, JSON.stringify(review));
    assert.equal((await requireReview(dir, reviewPath)).reviewers[0], 'placeholder');
    await (await import('node:fs/promises')).writeFile(reviewPath, JSON.stringify({ ...review, open_disagreements: [{ case_id: 'x', question: 'is this a duplicate?' }] }));
    await assert.rejects(requireReview(dir, reviewPath), /disagreement/);
    await (await import('node:fs/promises')).writeFile(reviewPath, JSON.stringify({ ...review, labels_sha256: sha256('changed') }));
    await assert.rejects(requireReview(dir, reviewPath), /re-review is required/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('review packet shows every original, its supporting documents, the policy and the expected answer', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'demo20-review-'));
  try {
    await writePack(dir, SEED);
    const html = await readFile(path.join(dir, 'review.html'), 'utf8');
    const pack = buildPack(SEED);
    for (const c of pack) {
      assert.ok(html.includes(c.case_id));
      for (const d of c.documents) assert.ok(html.includes(d.file), `review packet omits ${d.file}`);
      assert.ok(html.includes(c.label.rationale.slice(0, 40).replace(/&/g, '&amp;')));
    }
    assert.ok(html.includes(POLICY_WINDOW.start) && html.includes('not independent accuracy evidence'));
    const csv = (await readFile(path.join(dir, 'review.csv'), 'utf8')).trim().split('\n');
    assert.equal(csv.length, 21);
    assert.ok(csv[0].includes('agrees_yes_no'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cohort vocabulary stays closed', () => {
  const allowed: Cohort[] = ['straightforward_valid', 'unfamiliar_linked_booking', 'similar_distinct', 'duplicate_purchase', 'itinerary_identity', 'incomplete', 'violation'];
  for (const c of buildPack(SEED)) assert.ok(allowed.includes(c.label.cohort));
});
