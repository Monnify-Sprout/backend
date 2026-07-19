import { query } from '../../lib/db';

// PRD Phase 11: merchant-defined categories (name + colour) assignable to
// invoices. Every category is scoped to one merchant; all reads/writes below
// are keyed on merchant_id so a merchant can only ever touch their own.

export interface PublicCategory {
  id: string;
  merchant_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
  // How many of the merchant's invoices reference this category. Populated by
  // the list query (for the manager UI); undefined on single-row reads.
  invoice_count?: number;
}

const CATEGORY_COLUMNS = 'id, merchant_id, name, color, created_at, updated_at';

export interface NewCategory {
  merchantId: string;
  name: string;
  color: string;
}

// The unique (merchant_id, lower(name)) index throws 23505 on a duplicate; the
// service maps that to a friendly 409.
export async function insertCategory(input: NewCategory): Promise<PublicCategory> {
  const rows = await query<PublicCategory>(
    `insert into categories (merchant_id, name, color)
     values ($1, $2, $3)
     returning ${CATEGORY_COLUMNS}`,
    [input.merchantId, input.name, input.color],
  );
  return rows[0]!;
}

export async function listCategoriesForMerchant(
  merchantId: string,
): Promise<PublicCategory[]> {
  // The invoice count powers the manager (and warns before a delete). Left join
  // so a brand-new category with no invoices still reports 0.
  return query<PublicCategory>(
    `select ${CATEGORY_COLUMNS.split(', ')
      .map((c) => `c.${c}`)
      .join(', ')},
            count(i.id)::int as invoice_count
       from categories c
       left join invoices i on i.category_id = c.id
      where c.merchant_id = $1
      group by c.id
      order by lower(c.name)`,
    [merchantId],
  );
}

export async function findCategory(
  merchantId: string,
  categoryId: string,
): Promise<PublicCategory | null> {
  const rows = await query<PublicCategory>(
    `select ${CATEGORY_COLUMNS} from categories
      where id = $1 and merchant_id = $2 limit 1`,
    [categoryId, merchantId],
  );
  return rows[0] ?? null;
}

export interface CategoryPatch {
  name: string;
  color: string;
}

// Owner-scoped update. Returns the updated row, or null if no such category
// belongs to this merchant. Also maps to 23505 on a name collision.
export async function updateCategory(
  merchantId: string,
  categoryId: string,
  patch: CategoryPatch,
): Promise<PublicCategory | null> {
  const rows = await query<PublicCategory>(
    `update categories set name = $3, color = $4
      where id = $1 and merchant_id = $2
      returning ${CATEGORY_COLUMNS}`,
    [categoryId, merchantId, patch.name, patch.color],
  );
  return rows[0] ?? null;
}

// Delete = remove the category; the invoices.category_id FK is ON DELETE SET
// NULL, so its invoices are simply un-categorised, never removed. Owner-scoped.
export async function deleteCategory(
  merchantId: string,
  categoryId: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from categories where id = $1 and merchant_id = $2 returning id`,
    [categoryId, merchantId],
  );
  return rows.length > 0;
}
