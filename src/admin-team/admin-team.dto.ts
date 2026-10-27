import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const TEAM_ROLES = ['admin', 'super_admin'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export class AddTeamMemberDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsEmail()
  @MaxLength(120)
  email: string;

  @IsIn(TEAM_ROLES)
  role: TeamRole;
}

export class ChangeTeamRoleDto {
  @IsIn(TEAM_ROLES)
  role: TeamRole;
}

export class ChangeOwnPasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword: string;

  @IsString()
  @MinLength(10, { message: 'Use at least 10 characters' })
  @MaxLength(200)
  newPassword: string;
}
