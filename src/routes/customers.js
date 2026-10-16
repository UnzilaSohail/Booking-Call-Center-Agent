// Customer directory (ROADMAP.md §4) — CRUD + CSV import/export over
// src/services/customerService.js.
import { Router } from 'express';
import { listCustomers, countCustomers, getCustomerDetail, updateCustomer, toCsv, importCsv, findDuplicates, mergeCustomers } from '../services/customerService.js';
import { requireArea } from '../auth.js';

export const customersRouter = Router();

// Applied per-route (see the comment in src/routes/services.js for why).
const gate = requireArea('customers');

customersRouter.get('/customers', gate, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined; // ?q[]=x arrives as an array
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const items = await listCustomers(req.businessId, { q, limit, skip });
    // ?paged=1 answers { items, total } so the page can offer "show more"; without it, the plain list as before.
    res.json(req.query.paged ? { items, total: await countCustomers(req.businessId, q) } : items);
  } catch (err) {
    next(err);
  }
});

// Mounted before /customers/:id so "export" is never swallowed as an :id.
customersRouter.get('/customers/export', gate, async (req, res, next) => {
  try {
    const customers = await listCustomers(req.businessId, { all: true });
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="customers.csv"').send(toCsv(customers));
  } catch (err) {
    next(err);
  }
});

customersRouter.post('/customers/import', gate, async (req, res, next) => {
  try {
    const { csv } = req.body ?? {};
    if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'csv (string) is required' });
    res.json(await importCsv(req.businessId, csv));
  } catch (err) {
    next(err);
  }
});

customersRouter.get('/customers/:id', gate, async (req, res, next) => {
  try {
    const customer = await getCustomerDetail(req.businessId, req.params.id);
    if (!customer) return res.status(404).json({ error: 'customer not found' });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

customersRouter.get('/customers/:id/duplicates', gate, async (req, res, next) => {
  try {
    const found = await findDuplicates(req.businessId, req.params.id);
    if (!found) return res.status(404).json({ error: 'customer not found' });
    res.json(found);
  } catch (err) {
    next(err);
  }
});

// Body: { fromId } = the duplicate to fold into :id (the one that survives).
customersRouter.post('/customers/:id/merge', gate, async (req, res, next) => {
  try {
    const result = await mergeCustomers(req.businessId, req.body?.fromId, req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

customersRouter.patch('/customers/:id', gate, async (req, res, next) => {
  try {
    const updated = await updateCustomer(req.businessId, req.params.id, req.body ?? {});
    if (!updated) return res.status(404).json({ error: 'customer not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
