import {
  Button,
  Icon,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Row,
  Text,
} from '@umami/react-zen';
import { ArrowRight } from 'lucide-react';
import type { Key } from 'react';
import { IconLabel } from '@/components/common/IconLabel';
import { useLoginQuery, useMessages, useMobile, useNavigation } from '@/components/hooks';
import { ChevronRight, User, Users } from '@/components/icons';
import { LAST_TEAM_CONFIG } from '@/lib/constants';
import { removeItem } from '@/lib/storage';

export function TeamsButton() {
  const { user } = useLoginQuery();
  const { t, labels } = useMessages();
  const { teamId, router } = useNavigation();
  const { isPhone } = useMobile();
  const team = user?.teams?.find(({ id }) => id === teamId);
  const selectedKeys = new Set([teamId || 'user']);
  const label = teamId ? team?.name : user.username;

  const handleAction = async (key: Key) => {
    if (key === 'user') {
      removeItem(LAST_TEAM_CONFIG);
      router.push('/');
    }
  };

  return (
    <MenuTrigger>
      <Button variant="quiet">
        <Row
          alignItems="center"
          position="relative"
          gap
          maxHeight="40px"
          minWidth={isPhone ? '100px' : '200px'}
          maxWidth="200px"
        >
          <Icon>{teamId ? <Users /> : <User />}</Icon>
          <Text truncate>{label}</Text>
        </Row>
        <Icon rotate={90} size="sm">
          <ChevronRight />
        </Icon>
      </Button>
      <Menu className="min-w-[300px]" selectionMode="single" selectedKeys={selectedKeys}>
        <MenuSection title={t(labels.myAccount)}>
          <MenuItem id="user" onAction={handleAction}>
            <IconLabel icon={<User />} label={user.username} />
          </MenuItem>
        </MenuSection>
        <MenuSeparator />
        <MenuSection title={t(labels.teams)}>
          {user?.teams?.map(({ id, name }) => (
            <MenuItem key={id} id={id} onAction={() => router.push(`/teams/${id}`)}>
              <IconLabel icon={<Users />}>
                <Text wrap="nowrap">{name}</Text>
              </IconLabel>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem id="manage-teams" onAction={() => router.push('/settings/teams')}>
            <Row alignItems="center" justifyContent="space-between" gap width="100%">
              <Text align="center">Manage teams</Text>
              <Icon>
                <ArrowRight />
              </Icon>
            </Row>
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}
