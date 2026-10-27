"use client";

import {
  Box,
  Button,
  type ButtonProps,
  Collapse,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

type Props = {
  defaultColor?: ButtonProps["color"];
  confirmColor?: ButtonProps["color"];
  title: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon: React.ReactNode;
  onConfirm: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  compact?: boolean;
};

type ConfirmButtonHandle = {
  expanded: boolean;
};

const ConfirmButton = forwardRef<ConfirmButtonHandle, Props>(
  (
    {
      title,
      icon,
      onConfirm,
      loading = false,
      disabled = false,
      fullWidth = false,
      defaultColor = "primary",
      confirmColor = "error",
      onExpandedChange,
      compact = false,
    },
    ref,
  ) => {
    const TRANSITION_MS = 300;
    const AUTO_COLLAPSE_MS = 5000;

    const [expanded, setExpanded] = useState(false);
    const [showConfirmText, setShowConfirmText] = useState(false);
    const [collapsedWidth, setCollapsedWidth] = useState<number | undefined>(
      undefined,
    );
    const buttonRef = useRef<HTMLButtonElement>(null);
    const liveRegionRef = useRef<HTMLDivElement>(null);
    const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({ expanded }));

    useEffect(() => {
      onExpandedChange?.(expanded);
    }, [expanded, onExpandedChange]);

    useEffect(() => {
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = expanded
          ? "Click again to confirm"
          : "Confirmation canceled";
      }
    }, [expanded]);

    useEffect(() => {
      return () => {
        if (collapseTimerRef.current) {
          clearTimeout(collapseTimerRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (buttonRef.current && !expanded && !showConfirmText) {
        setCollapsedWidth(buttonRef.current.offsetWidth);
      }
    }, [expanded, showConfirmText]);

    useEffect(() => {
      if (expanded) {
        setShowConfirmText(true);
      } else {
        const timer = setTimeout(() => {
          setShowConfirmText(false);
        }, TRANSITION_MS);
        return () => clearTimeout(timer);
      }
    }, [expanded]);

    const handleClick = () => {
      if (expanded) {
        if (collapseTimerRef.current) {
          clearTimeout(collapseTimerRef.current);
        }
        setExpanded(false);
        onConfirm();
      } else {
        setExpanded(true);
        if (collapseTimerRef.current) {
          clearTimeout(collapseTimerRef.current);
        }
        collapseTimerRef.current = setTimeout(() => {
          setExpanded(false);
        }, AUTO_COLLAPSE_MS);
      }
    };

    if (compact) {
      return (
        <>
          <div
            ref={liveRegionRef}
            aria-live="polite"
            aria-atomic="true"
            style={{
              position: "absolute",
              left: "-10000px",
              width: "1px",
              height: "1px",
              overflow: "hidden",
            }}
          />
          <Tooltip title={title}>
            <IconButton
              disableRipple
              ref={buttonRef}
              loading={loading}
              onClick={handleClick}
              color={expanded ? confirmColor : defaultColor}
              disabled={disabled}
              size="small"
              aria-label={title}
              aria-expanded={expanded}
              aria-description={
                expanded
                  ? "Click again to confirm"
                  : "Click to expand, click again to confirm"
              }
              sx={{
                width: "24px",
                height: "24px",
                padding: "calc(0.5 * var(--mui-spacing));",
              }}
            >
              {icon}
            </IconButton>
          </Tooltip>
        </>
      );
    }

    return (
      <>
        <div
          ref={liveRegionRef}
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: "absolute",
            left: "-10000px",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        />
        <Collapse
          orientation="horizontal"
          in={expanded}
          collapsedSize={collapsedWidth}
          timeout={TRANSITION_MS}
          sx={{
            display: "flex",
            alignItems: "center",
            contain: "layout style",
            width: fullWidth ? "100%" : undefined,
          }}
        >
          <Tooltip title={title}>
            <Button
              loading={loading}
              disableRipple
              ref={buttonRef}
              onClick={handleClick}
              startIcon={icon}
              color={expanded ? confirmColor : defaultColor}
              disabled={disabled}
              fullWidth={fullWidth}
              aria-label={title}
              aria-expanded={expanded}
              aria-description={
                expanded
                  ? "Click again to confirm"
                  : "Click once to expand, click again to confirm"
              }
              sx={{
                transition: `color ${TRANSITION_MS}ms ease-in-out`,
                whiteSpace: "nowrap",
                height: "32px",
                minHeight: "32px",
              }}
            >
              <Box
                sx={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <Box
                  component="span"
                  sx={{
                    opacity: showConfirmText ? 0 : 1,
                    transition: "opacity 0.2s ease-in-out",
                    position: showConfirmText ? "absolute" : "relative",
                    left: 0,
                    pointerEvents: "none",
                  }}
                >
                  {title}
                </Box>
                <Box
                  component="span"
                  sx={{
                    opacity: showConfirmText ? 1 : 0,
                    transition: "opacity 0.2s ease-in-out",
                    position: showConfirmText ? "relative" : "absolute",
                    left: 0,
                    pointerEvents: "none",
                  }}
                >
                  Are you sure?
                </Box>
              </Box>
            </Button>
          </Tooltip>
        </Collapse>
      </>
    );
  },
);

ConfirmButton.displayName = "ConfirmButton";

export default ConfirmButton;
