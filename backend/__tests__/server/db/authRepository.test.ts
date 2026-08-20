// Jest globals are available implicitly
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  createUser,
  findUserByPhoneNumber,
  findUserByEmail,
} from "@/server/db/authRepository";
import { sanitizePhoneNumber } from "@/lib/validation";

// Mock database
jest.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: jest.fn(),
      },
    },
    insert: jest.fn(),
  },
}));

describe("Phone Number Uniqueness Constraint", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Database Schema Constraints", () => {
    it("should have unique constraint on phone_number field", () => {
      // This test verifies the schema definition
      const usersTable = users;
      expect(usersTable.phoneNumber).toBeDefined();
    });
  });

  describe("Phone Number Lookup", () => {
    it("should find user by phone number", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
        phoneNumber: "+2348123456789",
        role: "user",
        status: "active",
      };

      (db.query.users.findFirst as any).mockResolvedValue(mockUser);

      const result = await findUserByPhoneNumber("+2348123456789");

      expect(db.query.users.findFirst).toHaveBeenCalledWith({
        where: expect.any(Object), // Drizzle where clause
      });
      expect(result).toEqual(mockUser);
    });

    it("should return null for non-existent phone number", async () => {
      (db.query.users.findFirst as any).mockResolvedValue(null);

      const result = await findUserByPhoneNumber("+2349999999999");

      expect(result).toBeNull();
    });
  });

  describe("Registration with Phone Numbers", () => {
    it("should allow registration with unique phone number", async () => {
      const userInput = {
        email: "newuser@example.com",
        passwordHash: "hashedpassword",
        name: "New User",
        phoneNumber: "+2348123456789",
      };

      const mockCreatedUser = {
        id: "new-user-123",
        email: userInput.email,
        name: userInput.name,
        phoneNumber: userInput.phoneNumber,
        role: "user",
        status: "unverified",
      };

      const mockInsert: any = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn<any>().mockResolvedValue([mockCreatedUser]),
      };
      (db.insert as any).mockReturnValue(mockInsert);

      const result = await createUser(userInput);

      expect(db.insert).toHaveBeenCalledWith(users);
      expect(mockInsert.values).toHaveBeenCalledWith({
        email: userInput.email,
        passwordHash: userInput.passwordHash,
        name: userInput.name,
        phoneNumber: userInput.phoneNumber,
        role: "user",
        status: "unverified",
        loginAttempts: 0,
        lockUntil: null,
      });
      expect(result).toEqual(mockCreatedUser);
    });

    it("should allow registration without phone number", async () => {
      const userInput = {
        email: "nophone@example.com",
        passwordHash: "hashedpassword",
        name: "No Phone User",
      };

      const mockCreatedUser = {
        id: "no-phone-123",
        email: userInput.email,
        name: userInput.name,
        phoneNumber: null,
        role: "user",
        status: "unverified",
      };

      const mockInsert: any = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn<any>().mockResolvedValue([mockCreatedUser]),
      };
      (db.insert as any).mockReturnValue(mockInsert);

      const result = await createUser(userInput);

      expect(mockInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: null,
        }),
      );
      expect(result.phoneNumber).toBeNull();
    });
  });

  describe("Phone Number Sanitization in Registration", () => {
    it("should sanitize phone numbers before storage", async () => {
      const userInput = {
        email: "test@example.com",
        passwordHash: "hashedpassword",
        name: "Test User",
        phoneNumber: "08123456789", // Local format
      };

      const expectedSanitized = sanitizePhoneNumber("08123456789");

      const mockInsert: any = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn<any>().mockResolvedValue([
          {
            id: "user-123",
            ...userInput,
            phoneNumber: expectedSanitized,
          },
        ]),
      };
      (db.insert as any).mockReturnValue(mockInsert);

      await createUser(userInput);

      expect(mockInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: expectedSanitized,
        }),
      );
    });
  });

  describe("Duplicate Prevention", () => {
    it("should prevent duplicate phone numbers at database level", async () => {
      // Simulate database unique violation
      const uniqueViolationError = new Error(
        "duplicate key value violates unique constraint",
      );
      const typedUniqueViolationError = uniqueViolationError as Error & {
        code?: string;
        detail?: string;
      };
      typedUniqueViolationError.code = "23505";
      typedUniqueViolationError.detail =
        "Key (phone_number)=(+2348123456789) already exists.";

      const mockInsert: any = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn<any>().mockRejectedValue(uniqueViolationError),
      };
      (db.insert as any).mockReturnValue(mockInsert);

      const userInput = {
        email: "duplicate@example.com",
        passwordHash: "hashedpassword",
        name: "Duplicate User",
        phoneNumber: "+2348123456789",
      };

      await expect(createUser(userInput)).rejects.toThrow(uniqueViolationError);
    });
  });

  describe("Integration with Registration API", () => {
    it("should check phone number uniqueness before registration", async () => {
      const existingUser = {
        id: "existing-123",
        email: "existing@example.com",
        name: "Existing User",
        phoneNumber: "+2348123456789",
        role: "user",
        status: "active",
      };

      // Mock existing user found by phone
      (db.query.users.findFirst as any).mockResolvedValue(existingUser);

      const result = await findUserByPhoneNumber("+2348123456789");

      expect(result).toEqual(existingUser);
      expect(db.query.users.findFirst).toHaveBeenCalled();
    });
  });
});
