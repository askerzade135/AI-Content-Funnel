import { useState, useCallback } from 'react';
import { StoredVideo } from '../types';
import { PaidActionType, estimateCost } from '../utils/video-actions';

export interface ConfirmPaidActionOptions {
  actionType: PaidActionType;
  videos: StoredVideo[];
  onConfirm: () => Promise<void> | void;
  title?: string;
  description?: string;
}

export interface UsePaidConfirmationReturn {
  confirmPaidAction: (options: ConfirmPaidActionOptions) => Promise<void>;
  modalState: {
    isOpen: boolean;
    actionType: PaidActionType;
    videos: StoredVideo[];
    onConfirm: () => Promise<void> | void;
    title?: string;
    description?: string;
  };
  closeModal: () => void;
}

/**
 * Global interceptor hook for paid actions.
 * If estimateCost is 0 (all videos already processed/ready), it triggers onConfirm directly.
 * If estimateCost > 0, it opens the confirmation modal to require explicit user approval.
 */
export function usePaidConfirmation(): UsePaidConfirmationReturn {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    actionType: PaidActionType;
    videos: StoredVideo[];
    onConfirm: () => Promise<void> | void;
    title?: string;
    description?: string;
  }>({
    isOpen: false,
    actionType: 'stage1',
    videos: [],
    onConfirm: () => {},
  });

  const confirmPaidAction = useCallback(async (options: ConfirmPaidActionOptions) => {
    const { actionType, videos, onConfirm, title, description } = options;
    const cost = estimateCost(actionType, videos);

    // If estimateCost === 0, execute immediately without showing modal
    if (cost === 0) {
      await onConfirm();
      return;
    }

    // Otherwise, prompt user with the confirmation modal
    setModalState({
      isOpen: true,
      actionType,
      videos,
      onConfirm,
      title,
      description,
    });
  }, []);

  const closeModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return {
    confirmPaidAction,
    modalState,
    closeModal,
  };
}
