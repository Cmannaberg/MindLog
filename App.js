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
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwwXa7rVdHK8FyM0WATaPxqG-JqhgObu-u-IGIfg4_LleU57d6LU9aYTjVINn_LxtJT/exec';

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
  const nowMs = now.getTime();

  const todayStart = new Date(now);
  todayStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

  const allTimes = [];

  for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
    const windowStart = new Date(todayStart);
    const windowEnd = new Date(todayEnd);
    windowStart.setDate(windowStart.getDate() + dayOffset);
    windowEnd.setDate(windowEnd.getDate() + dayOffset);

    const startMs = dayOffset === 0 ? Math.max(nowMs, windowStart.getTime()) : windowStart.getTime();
    const endMs = windowEnd.getTime();
    const windowMs = endMs - startMs;

    if (windowMs <= 0) continue;

    for (let i = 0; i < NOTIFICATIONS_PER_DAY; i++) {
      allTimes.push(new Date(startMs + Math.random() * windowMs));
    }
  }

  allTimes.sort((a, b) => a - b);

  for (const t of allTimes) {
    const secondsUntil = Math.round((t.getTime() - nowMs) / 1000);
    if (secondsUntil <= 0) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'MindLog',
          body: 'What are you thinking right now?',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: secondsUntil,
          repeats: false,
        },
      });
    } catch (e) {
      console.log('Scheduling error:', e.message);
    }
  }
}

async function getScheduledNotifications() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const now = Date.now();
  return scheduled
    .map(n => {
      const t = n.trigger;
      if (t.seconds != null) {
        // TIME_INTERVAL trigger — approximate fire time
        return new Date(now + t.seconds * 1000);
      }
      const ms = t.date ?? t.value ?? t.timestamp;
      return ms ? new Date(ms) : null;
    })
    .filter(Boolean)
    .sort((a, b) => a - b);
}

function localTimestamp() {
  const now = new Date();
  return now.toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  });
}

async function logToSheets(thought) {
  if (SHEETS_URL === 'YOUR_APPS_SCRIPT_URL_HERE') return;
  const timestamp = localTimestamp();
  const url = `${SHEETS_URL}?timestamp=${encodeURIComponent(timestamp)}&thought=${encodeURIComponent(thought)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = () => resolve();
    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.send();
  });
}

export default function App() {
  const [thought, setThought] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [scheduledTimes, setScheduledTimes] = useState([]);
  const [permissionStatus, setPermissionStatus] = useState('checking...');
  const [showDebug, setShowDebug] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    (async () => {
      const { status } = await Notifications.getPermissionsAsync();
      setPermissionStatus(status);

      const granted = status === 'granted' || (await requestPermissions());
      if (granted) {
        setPermissionStatus('granted');
        try {
          await scheduleRandomNotifications();
        } catch (e) {
          setScheduleError(e.message);
        }
        const times = await getScheduledNotifications();
        setScheduledTimes(times);
      }
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

  async function handleSkip() {
    try {
      await logToSheets('skipped');
      setLastSaved(`${new Date().toLocaleTimeString()} (skipped)`);
    } catch (e) {
      Alert.alert('Skip failed', e.message);
    }
  }

  async function handleTestNotification() {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'MindLog Test',
          body: 'If you see this, notifications are working!',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 10,
          repeats: false,
        },
      });
      // refresh the count
      const times = await getScheduledNotifications();
      setScheduledTimes(times);
      Alert.alert('Test sent', 'Lock your phone and wait 10 seconds.');
    } catch (e) {
      Alert.alert('Scheduling error', e.message);
    }
  }

  const formatTime = (date) => {
    if (!(date instanceof Date) || isNaN(date)) return 'invalid';
    return date.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>MindLog</Text>
        <Text style={styles.version}>v3</Text>
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

        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipButtonText}>Skip — I'm busy</Text>
        </TouchableOpacity>

        {lastSaved && <Text style={styles.saved}>Saved at {lastSaved}</Text>}

        {/* Debug Section */}
        <TouchableOpacity style={styles.debugToggle} onPress={() => setShowDebug(!showDebug)}>
          <Text style={styles.debugToggleText}>{showDebug ? 'Hide' : 'Show'} diagnostics</Text>
        </TouchableOpacity>

        {showDebug && (
          <View style={styles.debugBox}>
            <Text style={styles.debugTitle}>Diagnostics</Text>
            <Text style={styles.debugText}>Notification permission: <Text style={styles.debugValue}>{permissionStatus}</Text></Text>
            <Text style={styles.debugText}>Notifications scheduled: <Text style={styles.debugValue}>{scheduledTimes.length}</Text></Text>
            {scheduleError && <Text style={[styles.debugText, { color: 'red' }]}>Schedule error: {scheduleError}</Text>}

            {scheduledTimes.length > 0 && (
              <>
                <Text style={[styles.debugText, { marginTop: 8 }]}>Upcoming times:</Text>
                {scheduledTimes.map((t, i) => (
                  <Text key={i} style={styles.debugTime}>  {formatTime(t)}</Text>
                ))}
              </>
            )}

            <TouchableOpacity style={styles.testButton} onPress={handleTestNotification}>
              <Text style={styles.testButtonText}>Send test notification (10 sec)</Text>
            </TouchableOpacity>
          </View>
        )}
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
  skipButton: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  skipButtonText: { color: '#999', fontSize: 15 },
  saved: { textAlign: 'center', color: '#888', marginTop: 16, fontSize: 14 },
  version: { fontSize: 11, color: '#ccc', marginBottom: 4 },
  debugToggle: { marginTop: 32, alignItems: 'center' },
  debugToggleText: { color: '#aaa', fontSize: 13 },
  debugBox: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  debugTitle: { fontSize: 15, fontWeight: '600', color: '#444', marginBottom: 10 },
  debugText: { fontSize: 13, color: '#666', marginBottom: 2 },
  debugValue: { fontWeight: '600', color: '#2c2c2c' },
  debugTime: { fontSize: 12, color: '#888' },
  testButton: {
    marginTop: 16,
    backgroundColor: '#7c4a4a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  testButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
