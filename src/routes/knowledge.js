// Knowledge base draft/publish/rollback workflow (ROADMAP.md §2) — the voice agent
// (src/voice/geminiSession.js) only ever reads the PUBLISHED `knowledge`, never the
// draft, so edits here can't affect a live call until an admin explicitly publishes.
import { Router } from 'express';
import { getDb } from '../db.js';
import { requireArea } from '../auth.js';

export const knowledgeRouter = Router();

// Applied per-route (see the comment in src/routes/services.js for why).
const gate = requireArea('settings');

const EMPTY_KNOWLEDGE = {
  greeting: null,
  faqs: [],
  booking_policy: null,
  cancellation_policy: null,
  preparation_instructions: null,
  restricted_topics: null,
  emergency_rules: null,
  pronunciation: [],
};

function normalizeFaqs(faqs) {
  if (!Array.isArray(faqs)) return [];
  return faqs
    .filter((f) => f?.question && f?.answer)
    .map((f) => ({ question: String(f.question).trim(), answer: String(f.answer).trim() }));
}

function normalizePronunciation(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p?.term && p?.pronunciation)
    .map((p) => ({ term: String(p.term).trim(), pronunciation: String(p.pronunciation).trim() }));
}

// Body -> the stored shape. Free-text fields fall back to null (not '') so a knowledge
// section with nothing set stays cleanly absent from the voice agent's prompt.
function normalizeKnowledge(body) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    greeting: text(body?.greeting),
    faqs: normalizeFaqs(body?.faqs),
    booking_policy: text(body?.bookingPolicy),
    cancellation_policy: text(body?.cancellationPolicy),
    preparation_instructions: text(body?.preparationInstructions),
    restricted_topics: text(body?.restrictedTopics),
    emergency_rules: text(body?.emergencyRules),
    pronunciation: normalizePronunciation(body?.pronunciation),
  };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// A business that never touched this UI has no `knowledge`/`knowledge_draft` yet — fall
// back to the legacy top-level `faqs` field (src/routes/platform.js / signup still write
// it) so the voice agent and this endpoint both still work with something real.
function withLegacyFallback(business, field) {
  if (business[field]) return business[field];
  return { ...EMPTY_KNOWLEDGE, faqs: business.faqs ?? [] };
}

knowledgeRouter.get('/knowledge', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne(
      { _id: req.businessId },
      { projection: { knowledge: 1, knowledge_draft: 1, knowledge_published_at: 1, faqs: 1 } }
    );
    const published = withLegacyFallback(business, 'knowledge');
    const draft = withLegacyFallback(business, 'knowledge_draft');
    res.json({
      draft,
      published,
      publishedAt: business.knowledge_published_at ?? null,
      hasUnpublishedChanges: !deepEqual(draft, published),
    });
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.put('/knowledge/draft', gate, async (req, res, next) => {
  try {
    const knowledge_draft = normalizeKnowledge(req.body);
    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { knowledge_draft } });
    res.json(knowledge_draft);
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.post('/knowledge/publish', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne(
      { _id: req.businessId },
      { projection: { knowledge_draft: 1, faqs: 1 } }
    );
    const snapshot = withLegacyFallback(business, 'knowledge_draft');

    const latest = await db.collection('knowledge_versions')
      .find({ business_id: req.businessId })
      .sort({ version: -1 })
      .limit(1)
      .toArray();
    const version = (latest[0]?.version ?? 0) + 1;
    const published_at = new Date();

    await db.collection('knowledge_versions').insertOne({
      business_id: req.businessId, version, snapshot,
      published_by_admin_id: req.adminId, published_at,
    });
    await db.collection('businesses').updateOne(
      { _id: req.businessId },
      { $set: { knowledge: snapshot, knowledge_draft: snapshot, knowledge_published_at: published_at } }
    );
    res.json({ version, publishedAt: published_at, published: snapshot });
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.get('/knowledge/versions', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const versions = await db.collection('knowledge_versions')
      .find({ business_id: req.businessId })
      .sort({ version: -1 })
      .limit(50)
      .toArray();

    const adminIds = [...new Set(versions.map((v) => v.published_by_admin_id).filter(Boolean))];
    const admins = adminIds.length
      ? await db.collection('admins').find({ _id: { $in: adminIds } }, { projection: { name: 1, email: 1 } }).toArray()
      : [];
    const adminById = Object.fromEntries(admins.map((a) => [a._id, a.name || a.email]));

    res.json(versions.map((v) => ({
      version: v.version,
      publishedAt: v.published_at,
      publishedByName: adminById[v.published_by_admin_id] ?? null,
      rolledBackFrom: v.rolled_back_from ?? null,
    })));
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.post('/knowledge/versions/:version/rollback', gate, async (req, res, next) => {
  try {
    const targetVersion = Number(req.params.version);
    if (!Number.isFinite(targetVersion)) return res.status(400).json({ error: 'invalid version' });

    const db = await getDb();
    const target = await db.collection('knowledge_versions').findOne({ business_id: req.businessId, version: targetVersion });
    if (!target) return res.status(404).json({ error: 'version not found' });

    const latest = await db.collection('knowledge_versions')
      .find({ business_id: req.businessId })
      .sort({ version: -1 })
      .limit(1)
      .toArray();
    const version = (latest[0]?.version ?? 0) + 1;
    const published_at = new Date();

    // Rollback is "publish the old content again" — history stays append-only, nothing
    // is ever deleted, and it shows up in the version list as its own entry.
    await db.collection('knowledge_versions').insertOne({
      business_id: req.businessId, version, snapshot: target.snapshot,
      published_by_admin_id: req.adminId, published_at, rolled_back_from: targetVersion,
    });
    // Both draft and published move to the restored content, so there's no confusing
    // "unpublished changes" banner immediately after rolling back.
    await db.collection('businesses').updateOne(
      { _id: req.businessId },
      { $set: { knowledge: target.snapshot, knowledge_draft: target.snapshot, knowledge_published_at: published_at } }
    );
    res.json({ version, publishedAt: published_at, published: target.snapshot });
  } catch (err) {
    next(err);
  }
});
