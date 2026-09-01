import { Injectable } from "@nestjs/common";
import { ApiException } from "../common/api.exception";
import { writeAuditLog } from "../common/audit-log.util";
import type { Landmark } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateLandmarkDto, UpdateLandmarkDto } from "./landmarks.dto";
import type { LandmarkView } from "./landmarks.types";

@Injectable()
export class LandmarksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<LandmarkView[]> {
    const landmarks = await this.prisma.landmark.findMany({ orderBy: { name: "asc" } });
    return landmarks.map(toLandmarkView);
  }

  async create(adminUserId: string, input: CreateLandmarkDto): Promise<LandmarkView> {
    const created = await this.prisma.$transaction(async (tx) => {
      const landmark = await tx.landmark.create({ data: normalize(input) });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: "LANDMARK_CREATED",
        entityType: "Landmark",
        entityId: landmark.id,
        metadata: { name: landmark.name }
      });
      return landmark;
    });
    return toLandmarkView(created);
  }

  async update(adminUserId: string, landmarkId: string, input: UpdateLandmarkDto): Promise<LandmarkView> {
    await this.getOrThrow(landmarkId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const landmark = await tx.landmark.update({ where: { id: landmarkId }, data: normalize(input) });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: "LANDMARK_UPDATED",
        entityType: "Landmark",
        entityId: landmark.id,
        metadata: { name: landmark.name }
      });
      return landmark;
    });
    return toLandmarkView(updated);
  }

  async delete(adminUserId: string, landmarkId: string): Promise<{ id: string }> {
    await this.getOrThrow(landmarkId);
    await this.prisma.$transaction(async (tx) => {
      await tx.landmark.delete({ where: { id: landmarkId } });
      await writeAuditLog(tx, {
        actorUserId: adminUserId,
        action: "LANDMARK_DELETED",
        entityType: "Landmark",
        entityId: landmarkId
      });
    });
    return { id: landmarkId };
  }

  private async getOrThrow(landmarkId: string): Promise<Landmark> {
    const landmark = await this.prisma.landmark.findUnique({ where: { id: landmarkId } });
    if (!landmark) throw new ApiException(404, "LANDMARK_NOT_FOUND", "This landmark does not exist.");
    return landmark;
  }
}

function normalize(input: CreateLandmarkDto | UpdateLandmarkDto) {
  return {
    name: input.name.trim(),
    latitude: input.latitude,
    longitude: input.longitude
  };
}

function toLandmarkView(landmark: Landmark): LandmarkView {
  return {
    id: landmark.id,
    name: landmark.name,
    latitude: landmark.latitude,
    longitude: landmark.longitude,
    createdAt: landmark.createdAt,
    updatedAt: landmark.updatedAt
  };
}
