import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, TextStyle } from 'react-native';

/**
 * The web app used the Material Symbols webfont ("local_library", "menu_book", …).
 * On native we map the same names onto the Material icon sets bundled with
 * @expo/vector-icons so call sites keep their original icon names.
 */
type MIName = React.ComponentProps<typeof MaterialIcons>['name'];
type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const MI: Record<string, MIName> = {
  local_library: 'local-library',
  menu_book: 'menu-book',
  tune: 'tune',
  arrow_back: 'arrow-back',
  bookmark: 'bookmark',
  bookmark_border: 'bookmark-border',
  bookmark_add: 'bookmark-add',
  search: 'search',
  close: 'close',
  volume_up: 'volume-up',
  style: 'style',
  touch_app: 'touch-app',
  account_circle: 'account-circle',
  help: 'help',
  info: 'info',
  local_fire_department: 'local-fire-department',
  travel_explore: 'travel-explore',
  done: 'done',
  check: 'check',
  check_small: 'check',
  check_circle: 'check-circle',
  cloud_upload: 'cloud-upload',
  palette: 'palette',
  upload_file: 'upload-file',
  upload: 'upload',
  file_upload: 'file-upload',
  sync: 'sync',
  image: 'image',
  title: 'title',
  sort: 'sort',
  expand_more: 'expand-more',
  unfold_more: 'unfold-more',
  add: 'add',
  mic: 'mic',
  edit_note: 'edit-note',
  translate: 'translate',
  ios_share: 'ios-share',
  delete: 'delete',
  delete_outline: 'delete-outline',
  history_edu: 'history-edu',
  post_add: 'post-add',
  open_in_new: 'open-in-new',
  hub: 'hub',
  output: 'output',
  database: 'storage',
  content_copy: 'content-copy',
  auto_stories: 'auto-stories',
  fullscreen: 'fullscreen',
  fullscreen_exit: 'fullscreen-exit',
  more_vert: 'more-vert',
  chevron_left: 'chevron-left',
  chevron_right: 'chevron-right',
  schedule: 'schedule',
  pause: 'pause',
  play_arrow: 'play-arrow',
  replay_10: 'replay-10',
  forward_10: 'forward-10',
  format_size: 'format-size',
  speed: 'speed',
  format_align_justify: 'format-align-justify',
  format_line_spacing: 'format-line-spacing',
  density_large: 'density-large',
  view_day: 'view-day',
  format_indent_increase: 'format-indent-increase',
  vertical_split: 'vertical-split',
  toc: 'toc',
  skip_previous: 'skip-previous',
  skip_next: 'skip-next',
  undo: 'undo',
};

const MCI: Record<string, MCIName> = {
  ink_pen: 'fountain-pen-tip',
  format_ink_highlighter: 'marker',
};

export type IconName = keyof typeof MI | keyof typeof MCI;

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Continuously rotate (used for the sync / upload spinners). */
  spin?: boolean;
  style?: StyleProp<TextStyle>;
}

export const Icon: React.FC<IconProps> = ({ name, size = 24, color = '#1c1c18', spin, style }) => {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spin) {
      rotation.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spin, rotation]);

  const glyph = MCI[name] ? (
    <MaterialCommunityIcons name={MCI[name]} size={size} color={color} style={style} />
  ) : (
    <MaterialIcons name={MI[name] ?? 'help-outline'} size={size} color={color} style={style} />
  );

  if (!spin) return glyph;

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={{ transform: [{ rotate }] }}>{glyph}</Animated.View>;
};
