import { useEffect, useState } from "react";

export interface User {
  id: string;
  email: string;
  name: string | null;
  phoneNumber: string | null;
  username: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token] = useState<string | null>(null);

  useEffect(() => {
    // Get token from localStorage or cookies
    const getToken = async () => {
      try {
        // Try to get from cookies first (if available)
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          setUser(data.user || data);
        } else if (response.status === 401) {
          setError("Not authenticated");
        } else {
          setError("Failed to fetch user data");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error fetching user");
      } finally {
        setIsLoading(false);
      }
    };

    getToken();
  }, []);

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
  };

  return { user, isLoading, error, token, updateUser };
}
