import { Request, Response, NextFunction } from "express";
import { userService } from "./user.service.js";
import { createUserSchema, updateUserSchema } from "./auth.schemas.js";

export async function listUsersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));

    const result = await userService.listUsers(page, pageSize);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function createUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createUserSchema.parse(req.body);
    const user = await userService.createUser(input);
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
}

export async function updateUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const input = updateUserSchema.parse(req.body);
    const user = await userService.updateUser(id, input);
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}
