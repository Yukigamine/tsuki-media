import CloseIcon from "@mui/icons-material/Close";
import {
  Dialog,
  type DialogProps,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";

interface SimpleDialogProps {
  onClose: () => void;
  title?: string;
  disableClose?: boolean;
}

function DialogContainer(
  props: React.PropsWithChildren<
    SimpleDialogProps & Omit<DialogProps, "onClose">
  >,
) {
  const { onClose, children, disableClose = false, ...dialogProps } = props;

  const handleClose = () => {
    if (!disableClose) {
      onClose();
    }
  };

  return (
    <Dialog {...dialogProps} onClose={handleClose}>
      {props.title && (
        <DialogTitle component={Typography} variant="h6">
          {props.title}
        </DialogTitle>
      )}

      <IconButton
        aria-label={props.title ? `Close ${props.title}` : "Close dialog"}
        disabled={disableClose}
        onClick={handleClose}
        style={{ position: "absolute", right: 8, top: 8 }}
      >
        <CloseIcon />
      </IconButton>
      {children}
    </Dialog>
  );
}

export default DialogContainer;
