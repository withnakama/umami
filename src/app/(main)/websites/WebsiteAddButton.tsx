import { Button, useToast } from '@umami/react-zen';
import { useState } from 'react';
import { IconLabel } from '@/components/common/IconLabel';
import { useMessages, useModified } from '@/components/hooks';
import { Plus } from '@/components/icons';
import { DialogButton } from '@/components/input/DialogButton';
import { WebsiteAddForm } from './WebsiteAddForm';

export function WebsiteAddButton({ teamId, onSave }: { teamId: string; onSave?: () => void }) {
  const { t, labels, messages } = useMessages();
  const { toast } = useToast();
  const { touch } = useModified();
  const [isOpen, setIsOpen] = useState(false);

  const handleSave = async () => {
    toast(t(messages.saved));
    touch('websites');
    onSave?.();
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };

  return (
    <>
      <Button onPress={() => handleOpenChange(true)} variant="primary">
        <IconLabel icon={<Plus />} label={t(labels.addWebsite)} />
      </Button>
      <DialogButton
        title={t(labels.addWebsite)}
        width="400px"
        isOpen={isOpen}
        onOpenChange={handleOpenChange}
      >
        {({ close }) => <WebsiteAddForm teamId={teamId} onSave={handleSave} onClose={close} />}
      </DialogButton>
    </>
  );
}
