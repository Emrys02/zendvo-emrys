import { POST } from "../../src/api/gifts/appreciate/route";
import { getAuthPayload } from "../../src/lib/auth-session";
import { sendAppreciationEmailToSender } from "../../src/server/services/emailService";
import { NextRequest } from "next/server";

jest.mock("../../src/lib/auth-session", () => ({
  getAuthPayload: jest.fn(),
}));

jest.mock("../../src/server/services/emailService", () => ({
  sendAppreciationEmailToSender: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock("../../src/lib/db", () => {
  const mockGifts: any[] = [];
  const mockUsers: any[] = [];

  return {
    db: {
      query: {
        gifts: {
          findFirst: jest.fn(async () => mockGifts[0] || null),
        },
        users: {
          findFirst: jest.fn(async () => mockUsers[0] || null),
        },
      },
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue([]),
      }),
    },
    __mockGifts: mockGifts,
    __mockUsers: mockUsers,
  };
});

describe("POST /api/gifts/:id/appreciate", () => {
  const mockGetAuthPayload = getAuthPayload as jest.Mock;
  const mockSendEmail = sendAppreciationEmailToSender as jest.Mock;
  const { __mockGifts, __mockUsers } = require("../../src/lib/db");

  beforeEach(() => {
    jest.clearAllMocks();
    __mockGifts.length = 0;
    __mockUsers.length = 0;
  });

  it("should return 401 Unauthorized if not logged in", async () => {
    mockGetAuthPayload.mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ message: "Thank you!" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(401);
  });

  it("should return 400 Bad Request if neither message nor template is provided", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "recipient-user" });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(400);
  });

  it("should return 403 Forbidden if logged in user is not recipient", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "wrong-user" });
    __mockGifts.push({
      id: "gift-1",
      recipientId: "recipient-user",
      senderId: "sender-user",
      senderEmail: "sender@example.com",
      amount: 100,
      currency: "USDC",
    });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ message: "Thanks so much!" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(403);
  });

  it("should successfully deliver appreciation email and in-app notification", async () => {
    mockGetAuthPayload.mockResolvedValue({ userId: "recipient-user" });
    __mockGifts.push({
      id: "gift-1",
      recipientId: "recipient-user",
      senderId: "sender-user",
      senderEmail: "sender@example.com",
      senderName: "Alice",
      amount: 100,
      currency: "USDC",
    });
    __mockUsers.push({
      id: "recipient-user",
      name: "Bob",
      email: "bob@example.com",
    });

    const req = new NextRequest("http://localhost:3000/api/gifts/gift-1/appreciate", {
      method: "POST",
      body: JSON.stringify({ message: "Thank you for the wonderful gift!" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "gift-1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        senderEmail: "sender@example.com",
        message: "Thank you for the wonderful gift!",
      })
    );
  });
});
