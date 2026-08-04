import { useCallback, useRef, useMemo } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { SymbolView } from "expo-symbols";
import Swipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { hapticLight, hapticSelect, hapticWarning } from "@/src/lib/haptics";
import { useTheme } from "@/src/context/ThemeContext";
import { radius, space, tap, type ThemeColors } from "@/src/theme";


type Props = {
  children: React.ReactNode;
  /** Indent / outer layout for tree depth */
  style?: StyleProp<ViewStyle>;
  /** Label used in a11y */
  label: string;
  onDelete: () => void;
  /** Optional secondary action (e.g. open full note) */
  onEdit?: () => void;
  /** Close any previously open row when this one opens */
  onWillOpen?: (methods: SwipeableMethods) => void;
};

/**
 * iMessage-style swipe-left row: reveals Edit + Delete under the card.
 * Only one row should stay open — parent tracks the open Swipeable via onWillOpen.
 */
export function NoteSwipeRow({
  children,
  style,
  label,
  onDelete,
  onEdit,
  onWillOpen,
}: Props) {
  const { color, ui, type } = useTheme();
  const styles = useMemo(() => makeSwipeStyles(color), [color]);
  const ref = useRef<SwipeableMethods | null>(null);

  const close = useCallback(() => {
    ref.current?.close();
  }, []);

  const renderRightActions = useCallback(() => {
    return (
      <View style={styles.actions} accessibilityRole="menu">
        {onEdit ? (
          <Pressable
            style={({ pressed }) => [
              styles.action,
              styles.actionEdit,
              pressed && styles.actionPressed,
            ]}
            onPress={() => {
              hapticSelect();
              close();
              onEdit();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Edit note ${label}`}
          >
            <SymbolView
              name="square.and.pencil"
              size={20}
              weight="semibold"
              tintColor="#fff"
              fallback={<Text style={styles.actionIconFallback}>✎</Text>}
            />
            <Text style={styles.actionTxt}>Note</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.action,
            styles.actionDelete,
            pressed && styles.actionPressed,
          ]}
          onPress={() => {
            hapticWarning();
            close();
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Delete note ${label}`}
        >
          <SymbolView
            name="trash"
            size={20}
            weight="semibold"
            tintColor="#fff"
            fallback={<Text style={styles.actionIconFallback}>⌫</Text>}
          />
          <Text style={styles.actionTxt}>Delete</Text>
        </Pressable>
      </View>
    );
  }, [close, label, onDelete, onEdit]);

  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootRight={false}
      overshootFriction={8}
      rightThreshold={40}
      containerStyle={[styles.container, style]}
      childrenContainerStyle={styles.children}
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={() => {
        hapticLight();
        if (ref.current) onWillOpen?.(ref.current);
      }}
    >
      {children}
    </Swipeable>
  );
}

function makeSwipeStyles(color: ThemeColors) {
  return StyleSheet.create({
  container: {
    overflow: "hidden",
    borderRadius: radius.md,
    marginBottom: space[2],
  },
  children: {
    // Keep card chrome on the sliding front panel
  },
  actions: {
    flexDirection: "row",
    alignItems: "stretch",
    // Match card height — Swipeable sizes the action rail to the row
    alignSelf: "stretch",
    marginLeft: space[1],
  },
  action: {
    width: 76,
    minHeight: tap + space[4],
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: space[2],
  },
  actionEdit: {
    backgroundColor: color.inkSoft,
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
  },
  actionDelete: {
    backgroundColor: color.danger,
    // When Edit is present, only the outer corners round
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  actionPressed: {
    opacity: 0.85,
  },
  actionTxt: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
  actionIconFallback: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
}
