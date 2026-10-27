import { Router } from "express";
import { listUsersHandler, createUserHandler, updateUserHandler } from "./user.controller.js";
import { requireAuth } from "../../middleware/session.js";
import { requirePermission } from "../../middleware/permissions.js";

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.use(requirePermission("user:manage"));

userRouter.get("/", listUsersHandler);
userRouter.post("/", createUserHandler);
userRouter.patch("/:id", updateUserHandler);
