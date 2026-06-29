import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class OnboardCustomerDto {
  /**
   * Email address used as the portal login username and the destination for the
   * welcome email. Defaults to the customer's contactEmail when omitted.
   */
  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  /** Display name for the created user. Defaults to the customer's contactName. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;
}
