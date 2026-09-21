import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { normalizePkPhone, PK_PHONE_REGEX } from '../phone.js';

// Normalizes any accepted Pakistani mobile format to +923XXXXXXXXX, then validates.
export const IsPkPhone = () =>
  applyDecorators(
    Transform(({ value }) =>
      typeof value === 'string' ? (normalizePkPhone(value) ?? value) : value,
    ),
    Matches(PK_PHONE_REGEX, {
      message:
        'phone must be a valid Pakistani mobile number, e.g. 03001234567',
    }),
  );
