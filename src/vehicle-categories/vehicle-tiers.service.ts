import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { VehicleCategoriesService } from './vehicle-categories.service.js';
import {
  servingCategories,
  suggestTiers,
  tiersOf,
  type TierVehicle,
} from './vehicle-tiers.js';

// Ride tiers against the database: what a vehicle serves, what an admin is
// suggested, and keeping online drivers' ride types current when tiers or
// a vehicle's approval change.
@Injectable()
export class VehicleTiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: VehicleCategoriesService,
  ) {}

  async servingFor(vehicle: TierVehicle) {
    return servingCategories(vehicle, await this.categories.allForTiers());
  }

  async suggestFor(vehicle: TierVehicle) {
    return suggestTiers(vehicle, await this.categories.allForTiers());
  }

  // The tiers of a base type (for an admin or driver screen).
  async tiersOf(base: string) {
    return tiersOf(base, await this.categories.allForTiers());
  }

  // Throws unless every key is a tier of this vehicle's type.
  async assertTiersOf(base: string, keys: string[]) {
    const tiers = new Set((await this.tiersOf(base)).map((c) => c.key));
    const unknown = keys.filter((k) => !tiers.has(k) && k !== base);
    if (unknown.length) {
      throw new BadRequestException(
        `Not a tier of ${base}: ${unknown.join(', ')}`,
      );
    }
  }

  // On approval: a vehicle with no tiers yet gets the ones it meets (the
  // admin can change them later).
  async applySuggestion(vehicleIds: string[]) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
    });
    for (const v of vehicles) {
      if (v.tiers.length) continue;
      const tiers = await this.suggestFor(v);
      if (tiers.length) {
        await this.prisma.vehicle.update({
          where: { id: v.id },
          data: { tiers },
        });
      }
    }
  }

  // The ride types a vehicle has, for the driver's own screen: which it may
  // take, and which the driver switched off.
  async rideTypesFor(vehicle: TierVehicle) {
    const all = await this.categories.allForTiers();
    const base = all.find((c) => c.key === vehicle.category);
    const open = servingCategories({ ...vehicle, tiersOff: [] }, all);
    return [base, ...tiersOf(vehicle.category, all)]
      .filter((c) => c != null && open.includes(c.key))
      .map((c) => ({
        key: c!.key,
        label: c!.label,
        on: !vehicle.tiersOff.includes(c!.key),
      }));
  }

  // Re-works out the ride types of online drivers (all of one base type, or
  // the one on a given vehicle) after tiers or approvals changed.
  async refreshOnline(filter: { base?: string; vehicleId?: string }) {
    const online = await this.prisma.driverPresence.findMany({
      where: {
        isOnline: true,
        ...(filter.base && { category: filter.base }),
        ...(filter.vehicleId && { vehicleId: filter.vehicleId }),
      },
      select: { userId: true, vehicleId: true },
    });
    if (!online.length) return;
    const vehicles = await this.prisma.vehicle.findMany({
      where: { id: { in: online.map((o) => o.vehicleId) } },
    });
    for (const p of online) {
      const vehicle = vehicles.find((v) => v.id === p.vehicleId);
      if (!vehicle) continue;
      await this.prisma.driverPresence.update({
        where: { userId: p.userId },
        data: { categories: await this.servingFor(vehicle) },
      });
    }
  }
}
