import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class PasswordChangeGuard extends AuthGuard("jwt-password-change") {}
