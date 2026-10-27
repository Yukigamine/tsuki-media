"use client";
import { Link as MuiLink, type LinkProps as MuiLinkProps } from "@mui/material";
import NextLink, { type LinkProps as NextLinkProps } from "next/link";
import { forwardRef } from "react";

type LinkProps = MuiLinkProps<typeof NextLink> & NextLinkProps;

export default forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, ...props }, ref) => (
    <MuiLink component={NextLink} href={href} ref={ref} {...props} />
  ),
);
