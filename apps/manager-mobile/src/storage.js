import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import {Platform} from 'react-native'
import {seedRequests} from './model'
const DATA='demo-manager-native-v1',SESSION='demo-manager-native-session'
export async function loadWorkspace(){try{const raw=await AsyncStorage.getItem(DATA);const value=raw?JSON.parse(raw):null;if(Array.isArray(value?.requests)&&Array.isArray(value?.read))return value}catch{}return {requests:seedRequests(),read:[],alerts:true}}
export async function saveWorkspace(value){await AsyncStorage.setItem(DATA,JSON.stringify(value))}
// Native sessions use SecureStore. Expo Web uses sessionStorage for demo parity.
export async function loadSession(){try{const raw=Platform.OS==='web'?globalThis.sessionStorage?.getItem(SESSION):await SecureStore.getItemAsync(SESSION);const value=raw?JSON.parse(raw):null;return value?.role==='manager'&&value.expires>Date.now()}catch{return false}}
export async function saveSession(){const value=JSON.stringify({role:'manager',expires:Date.now()+8*3600000});if(Platform.OS==='web')globalThis.sessionStorage.setItem(SESSION,value);else await SecureStore.setItemAsync(SESSION,value)}
export async function clearSession(){if(Platform.OS==='web')globalThis.sessionStorage?.removeItem(SESSION);else await SecureStore.deleteItemAsync(SESSION)}
