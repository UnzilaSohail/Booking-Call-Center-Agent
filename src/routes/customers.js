// Customer directory (ROADMAP.md §4) — CRUD + CSV import/export over
// src/services/customerService.js.
import { Router } from 'express';
import { listCustomers, getCustomerDetail, updateCustomer, toCsv, importCsv } from '../services/customerService.js';

export const customersRouter = Router();

customersRouter.get('/customers', async (req, res, next) => {
  try {
    res.json(await listCustomers(req.businessId, { q: req.query.q }));
  } catch (err) {
    next(err);
  }
});

// Mounted before /customers/:id so "export" is never swallowed as an :id.
customersRouter.get('/customers/export', async (req, res, next) => {
  try {
    const customers = await listCustomers(req.businessId, {});
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="customers.csv"').send(toCsv(customers));
  } catch (err) {
    next(err);
  }
});

customersRouter.post('/customers/import', async (req, res, next) => {
  try {
    const { csv } = req.body ?? {};
    if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'csv (string) is required' });
    res.json(await importCsv(req.businessId, csv));
  } catch (err) {
    next(err);
  }
});

customersRouter.get('/customers/:id', async (req, res, next) => {
  try {
    const customer = await getCustomerDetail(req.businessId, req.params.id);
    if (!customer) return res.status(404).json({ error: 'customer not found' });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

customersRouter.patch('/customers/:id', async (req, res, next) => {
  try {
    const updated = await updateCustomer(req.businessId, req.params.id, req.body ?? {});
    if (!updated) return res.status(404).json({ error: 'customer not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
