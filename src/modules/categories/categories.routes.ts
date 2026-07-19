import { Router } from 'express';

import { formatZodError } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';

import { createCategorySchema, updateCategorySchema } from './categories.schema';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from './categories.service';

export const categoryRouter = Router();

// All category routes are merchant-scoped (PRD Phase 11).
categoryRouter.use(requireAuth);

// GET /api/categories - the merchant's categories with per-category invoice counts.
categoryRouter.get('/', async (req, res, next) => {
  try {
    const categories = await listCategories(req.merchant!.id);
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// POST /api/categories - create a category (name + colour).
categoryRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const category = await createCategory(req.merchant!.id, parsed.data);
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/categories/:id - rename / recolour.
categoryRouter.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid category id.');
    }
    const parsed = updateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const category = await updateCategory(req.merchant!.id, id, parsed.data);
    res.json({ category });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/categories/:id - remove it; its invoices are un-categorised, not
// deleted (invoices.category_id is ON DELETE SET NULL).
categoryRouter.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid category id.');
    }
    await deleteCategory(req.merchant!.id, id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
