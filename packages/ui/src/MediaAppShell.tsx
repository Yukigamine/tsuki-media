"use client";

import {
  AppBar,
  Box,
  Button,
  Container,
  Toolbar,
  Typography,
} from "@mui/material";
import Image from "next/image";
import type { PropsWithChildren } from "react";
import { ColorModeButton } from "./Providers";

type Props = PropsWithChildren<{
  title: string;
}>;

export function MediaAppShell({ title, children }: Props) {
  return (
    <Box sx={{ minHeight: "100dvh" }}>
      <AppBar position="static">
        <Toolbar sx={{ gap: 1 }}>
          <Image
            src="/icons/tsuki/squirlecon.svg"
            alt=""
            width={40}
            height={40}
          />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
          <Button
            color="inherit"
            href={
              process.env.NEXT_PUBLIC_ANIME_APP_URL || "http://localhost:3000"
            }
          >
            Anime
          </Button>
          <Button
            color="inherit"
            href={
              process.env.NEXT_PUBLIC_BOOKS_APP_URL || "http://localhost:3001"
            }
          >
            Books
          </Button>
          <Button
            color="inherit"
            href={
              process.env.NEXT_PUBLIC_MOVIES_APP_URL || "http://localhost:3002"
            }
          >
            Movies
          </Button>
          <ColorModeButton />
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
        {children}
      </Container>
    </Box>
  );
}
