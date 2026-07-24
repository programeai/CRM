import { Badge } from '@/components/ui/badge';
import { tagColors } from '@/lib/tag-color';

/**
 * Chip de tag com cor de fundo determinística e texto de contraste automático
 * (preto ou branco), decidido por `readableTextColor`. Use sempre este
 * componente para renderizar tags — não monte badges de tag à mão.
 */
export function TagBadge({
  tag,
  ...rest
}: Omit<React.ComponentProps<typeof Badge>, 'variant' | 'children' | 'style'> & {
  tag: string;
}) {
  return (
    <Badge
      variant="secondary"
      style={{ ...tagColors(tag), borderColor: 'transparent' }}
      {...rest}
    >
      {tag}
    </Badge>
  );
}
