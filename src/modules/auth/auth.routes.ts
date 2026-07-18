import { Router } from 'express';

import { formatZodError } from '../../lib/validation';
import { HttpError } from '../../middleware/error';
import { loginSchema, registerSchema } from './auth.schema';
import { loginMerchant, registerMerchant } from './auth.service';

export const authRouter = Router();

authRouter.post('/register', async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const merchant = await registerMerchant(parsed.data);
    res.status(201).json({ merchant });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const result = await loginMerchant(parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
