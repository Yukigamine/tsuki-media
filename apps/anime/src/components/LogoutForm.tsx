"use client";

import LogoutIcon from "@mui/icons-material/Logout";
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  Typography,
} from "@mui/material";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { logoutAppAction } from "@/lib/actions/auth";

interface LogoutFormProps {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
}

export default function LogoutForm({ user }: LogoutFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      const result = await logoutAppAction();
      if (result.ok) {
        router.refresh();
        router.push("/login");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container
      maxWidth="sm"
      sx={{ display: "flex", alignItems: "center", minHeight: "100vh" }}
    >
      <Card sx={{ width: "100%" }}>
        <CardContent>
          <Stack spacing={3} sx={{ alignItems: "center" }}>
            <Typography variant="h4" component="h1" align="center">
              Log out?
            </Typography>

            <Box sx={{ textAlign: "center" }}>
              <Typography variant="body1" color="textSecondary" gutterBottom>
                Signed in as
              </Typography>
              <Typography variant="h6">{user.name}</Typography>
              {user.email && (
                <Typography variant="body2" color="textSecondary">
                  {user.email}
                </Typography>
              )}
            </Box>

            <Stack direction="row" spacing={2} sx={{ width: "100%" }}>
              <Button
                variant="outlined"
                fullWidth
                onClick={() => window.history.back()}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                color="error"
                fullWidth
                startIcon={<LogoutIcon />}
                onClick={handleLogout}
                disabled={isLoading}
              >
                {isLoading ? "Logging out..." : "Log out"}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
