import { Module } from '@nestjs/common';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminWalletController } from './admin-wallet.controller.js';
import { AdminWalletService } from './admin-wallet.service.js';
import { WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';

// Wallets: balances and their ledger, top-ups and withdrawals checked by
// admins, ride payments by wallet and commission. Paying in through a
// gateway (JazzCash, Easypaisa, cards) is a later adapter; today top-ups are
// transfers an admin confirms.
@Module({
  imports: [AuthModule, AdminNotificationsModule],
  controllers: [WalletController, AdminWalletController],
  providers: [WalletService, AdminWalletService],
  exports: [WalletService],
})
export class WalletModule {}
