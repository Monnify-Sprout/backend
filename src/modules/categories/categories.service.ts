import { HttpError } from '../../middleware/error';
import { isUniqueViolation } from '../auth/auth.repo';

import {
  deleteCategory as deleteCategoryRow,
  findCategory,
  insertCategory,
  listCategoriesForMerchant,
  updateCategory as updateCategoryRow,
  type PublicCategory,
} from './categories.repo';
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schema';

const DUPLICATE_MESSAGE = 'You already have a category with that name.';

export function listCategories(merchantId: string): Promise<PublicCategory[]> {
  return listCategoriesForMerchant(merchantId);
}

export async function createCategory(
  merchantId: string,
  input: CreateCategoryInput,
): Promise<PublicCategory> {
  try {
    return await insertCategory({
      merchantId,
      name: input.name,
      color: input.color,
    });
  } catch (err) {
    // The case-insensitive unique index rejects a duplicate name.
    if (isUniqueViolation(err)) {
      throw new HttpError(409, DUPLICATE_MESSAGE);
    }
    throw err;
  }
}

export async function updateCategory(
  merchantId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<PublicCategory> {
  try {
    const updated = await updateCategoryRow(merchantId, categoryId, {
      name: input.name,
      color: input.color,
    });
    if (!updated) {
      throw new HttpError(404, 'Category not found.');
    }
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, DUPLICATE_MESSAGE);
    }
    throw err;
  }
}

export async function deleteCategory(
  merchantId: string,
  categoryId: string,
): Promise<void> {
  const deleted = await deleteCategoryRow(merchantId, categoryId);
  if (!deleted) {
    throw new HttpError(404, 'Category not found.');
  }
}

// Used by invoice creation: confirm a category_id (if supplied) belongs to the
// merchant before it is stored on an invoice. Returns the resolved category so
// callers can reuse it, or null when none was requested.
export async function assertOwnedCategory(
  merchantId: string,
  categoryId: string | undefined,
): Promise<PublicCategory | null> {
  if (!categoryId) {
    return null;
  }
  const category = await findCategory(merchantId, categoryId);
  if (!category) {
    throw new HttpError(422, 'Unknown category.');
  }
  return category;
}
