import AddIcon from "@mui/icons-material/Add";
import { Button, IconButton, Tooltip } from "@mui/material";
import AppLink from "@/components/Link";

type Props = {
  type: "anime" | "manga";
  iconOnly?: boolean;
};

export function CollectionAddButton({ type, iconOnly = false }: Props) {
  const label = `Add ${type} to collection`;
  const href = `/collection/${type}/add`;

  if (iconOnly) {
    return (
      <Tooltip title={label}>
        <IconButton
          component={AppLink}
          href={href}
          aria-label={label}
          sx={{
            width: 40,
            height: 40,
            borderRadius: "10px",
            bgcolor: "primary.main",
            color: "primary.contrastText",
            "&:hover": { bgcolor: "primary.dark" },
          }}
        >
          <AddIcon />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Button
      variant="contained"
      startIcon={<AddIcon />}
      component={AppLink}
      href={href}
      sx={{
        textTransform: "none",
        whiteSpace: "nowrap",
        width: "fit-content",
        flexShrink: 0,
      }}
    >
      Add
    </Button>
  );
}
