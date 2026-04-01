import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import axios from 'axios';

// --- Config -----------------------------------------------------------
// Paste your Google Apps Script Web App URL here after setup (Step 2)
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbynufz1dX4pnsU0fofDORYfJCLzIumZcHJLJm6Ip8fAfR7DibZO-ppvpEu8qKuIZgtzug/exec';

// Notification window: 8am to 10pm
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;
const NOTIFICATIONS_PER_DAY = 6;
// ----------------------------------------------------------------------

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function requestPermissions() {
  if (!Device.isDevice) {
    Alert.alert('Use a real device for notifications');
    return false;
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function scheduleRandomNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

  // Schedule for today (remaining window) and tomorrow
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const windowStart = new Date(todayStart);
    const windowEnd = new Date(todayEnd);
    windowStart.setDate(windowStart.getDate() + dayOffset);
    windowEnd.setDate(windowEnd.getDate() + dayOffset);

    const startMs = dayOffset === 0 ? Math.max(now.getTime(), windowStart.getTime()) : windowStart.getTime();
    const endMs = windowEnd.getTime();
    const windowMs = endMs - startMs;

    if (windowMs <= 0) continue;

    const times = [];
    for (let i = 0; i < NOTIFICATIONS_PER_DAY; i++) {
      times.push(new Date(startMs + Math.random() * windowMs));
    }
    times.sort((a, b) => a - b);

    for (const t of times) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'MindLog',
          body: 'What are you thinking right now?',
        },
        trigger: { date: t },
      });
    }
  }
}

async function logToSheets(thought) {
  if (SHEETS_URL === 'YOUR_APPS_SCRIPT_URL_HERE') return; // not configured yet
  const timestamp = new Date().toISOString();
  await axios.post(SHEETS_URL, { timestamp, thought });
}

export default function App() {
  const [thought, setThought] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    (async () => {
      const granted = await requestPermissions();
      if (granted) await scheduleRandomNotifications();
    })();

    notificationListener.current = Notifications.addNotificationReceivedListener(() => {});
    responseListener.current = Notifications.addNotificationResponseReceivedListener(() => {});

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  async function handleSave() {
    if (!thought.trim()) return;
    setSaving(true);
    try {
      await logToSheets(thought.trim());
      setLastSaved(new Date().toLocaleTimeString());
      setThought('');
    } catch (e) {
      Alert.alert('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>MindLog</Text>
        <Text style={styles.prompt}>What are you thinking right now?</Text>

        <TextInput
          style={styles.input}
          multiline
          placeholder="Type your thought here..."
          placeholderTextColor="#aaa"
          value={thought}
          onChangeText={setThought}
          autoFocus
        />

        <TouchableOpacity
          style={[styles.button, (!thought.trim() || saving) && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={!thought.trim() || saving}
        >
          <Text style={styles.buttonText}>{saving ? 'Saving...' : 'Save'}</Text>
        </TouchableOpacity>

        {lastSaved && <Text style={styles.saved}>Saved at {lastSaved}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f6f0' },
  inner: { flexGrow: 1, padding: 28, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '700', color: '#2c2c2c', marginBottom: 8 },
  prompt: { fontSize: 18, color: '#666', marginBottom: 32 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 160,
    textAlignVertical: 'top',
    color: '#2c2c2c',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#4a7c59',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#bbb' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  saved: { textAlign: 'center', color: '#888', marginTop: 16, fontSize: 14 },
});
